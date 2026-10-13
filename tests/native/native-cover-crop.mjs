import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
import { expectCoverWindowMatchesBanner } from '../support/cover-crop.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const albums = db.prepare("SELECT data FROM entities WHERE kind='albums'").all().map(row => JSON.parse(row.data));
const album = albums.find(item => item.cover && item.name.includes('机械纪元')) || albums.find(item => item.cover);
if (!album) throw Error('An existing album cover is required for read-only acceptance');
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const previousRoute = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__coverCropOriginalFetch = original;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_recent') return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command))
          return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  await page.evaluate(id => { location.hash = `/album/${id}`; }, album.id);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expectCoverWindowMatchesBanner(page);
  await expect(page.locator('.cover-crop-window')).toHaveCSS('box-shadow', /rgba\(96, 96, 96, 0.58\)/);
  const stage = page.locator('.cover-crop-stage');
  const initialStyle = await stage.locator('img').getAttribute('style');
  const window = await page.locator('.cover-crop-window').boundingBox();
  const start = { x: window.x + window.width / 2, y: window.y + window.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 24);
  await page.mouse.up();
  await stage.focus();
  await stage.press('+');
  await stage.press('ArrowUp');
  expect(await stage.locator('img').getAttribute('style')).not.toBe(initialStyle);
  await page.getByRole('button', { name: '恢复默认封面' }).click();
  await expectCoverWindowMatchesBanner(page);
  expect(await stage.locator('img').getAttribute('style')).toBe(initialStyle);
  await page.mouse.move(10, 10);
  await mkdir('verification/cover-crop', { recursive: true });
  await page.screenshot({ path: 'verification/cover-crop/installed-editor.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'verification/cover-crop/installed-banner.png' });
  await page.evaluate(hash => { location.hash = hash; }, previousRoute);
  await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry,
    maskedBannerWindow: true, savedCropMatchesBanner: true, dragAndKeyboard: true,
    resetRestoresSavedCrop: true, cancelDoesNotWrite: true, catalogUnchanged: true, errors };
  await writeFile('verification/cover-crop/installed-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.evaluate(() => { if (window.__coverCropOriginalFetch) { window.fetch = window.__coverCropOriginalFetch; delete window.__coverCropOriginalFetch; } }).catch(() => {});
  db.close();
  await browser.close();
}
