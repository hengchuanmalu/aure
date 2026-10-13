import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed WebView2 acceptance; production metadata and media remain read-only.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(root);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'json');
const before = snapshot();
const models = db.prepare("SELECT data FROM entities WHERE kind='models'").all().map(row => JSON.parse(row.data));
const model = models.find(model => model.avatar && model.background);
const album = db.prepare("SELECT data FROM entities WHERE kind='albums'").all().map(row => JSON.parse(row.data)).find(album => album.cover);
if (!model || !album) throw Error('An existing avatar, background and cover are required for read-only acceptance');
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const previousRoute = await page.evaluate(() => location.hash);
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  // Album entry normally records history. Block that write before changing routes.
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__lightboxOriginalFetch = original;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_recent') return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) {
          return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
        }
      }
      return original.call(window, input, options);
    };
  }, recent);
  await mkdir('verification/image-lightbox', { recursive: true });
  await page.evaluate(id => { location.hash = `/models/${id}`; }, model.id);
  const check = async (name, screenshot, aspectRatio, circular = false) => {
    const trigger = page.getByRole('button', { name, exact: true });
    await expect.poll(() => trigger.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const sourceStyle = await trigger.locator('img').getAttribute('style');
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const frame = dialog.locator('.image-lightbox-crop');
    await expect.poll(() => frame.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS('clip-path', 'inset(50%)');
    await expect(dialog.getByRole('button')).toHaveCount(0);
    await expect(dialog).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const box = await frame.boundingBox();
    expect(box.width / box.height).toBeCloseTo(aspectRatio, 2);
    if (circular) await expect(frame).toHaveCSS('border-radius', '50%');
    if (sourceStyle) expect(await frame.locator('img').getAttribute('style')).toBe(sourceStyle);
    await expect(frame).toBeInViewport({ ratio: 1 });
    await frame.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `verification/image-lightbox/${screenshot}.png` });
    await page.mouse.click(circular ? box.x + 2 : 10, circular ? box.y + 2 : 10);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  };
  await check('查看头像大图', 'avatar-installed', 1, true);
  await check('查看背景大图', 'background-installed', 16 / 9);
  await page.evaluate(id => { location.hash = `/album/${id}`; }, album.id);
  const cover = await page.getByRole('button', { name: '查看封面大图', exact: true }).boundingBox();
  await check('查看封面大图', 'cover-installed', cover.width / cover.height);
  await page.evaluate(hash => { location.hash = hash; }, previousRoute);
  await expect(page.locator('.image-lightbox')).toHaveCount(0);
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const report = { installedBuild: true, engine: 'Windows WebView2', avatarCircularCrop: true, backgroundCrop: true,
    coverCrop: true, noVisibleText: true, noPanelOrCloseButton: true, imageClickKeepsOpen: true,
    blankClickCloses: true, escapeCloses: true, focusRestored: true, catalogUnchanged: true, errors };
  await writeFile('verification/image-lightbox/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => { if (window.__lightboxOriginalFetch) window.fetch = window.__lightboxOriginalFetch; }).catch(() => {});
  db.close();
  await browser.close();
}
