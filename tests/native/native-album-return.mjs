import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only installed WebView2 acceptance. Intercept history at the fetch layer;
// Tauri freezes its invoke function. Verify interception with a read first.
import { expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(root);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'json');
const before = snapshot();
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
page.setDefaultTimeout(10000);
let intercepted = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__albumFilterOriginalFetch = original;
    window.__albumFilterReadProbe = true; window.__continuousReads = [];
    window.__albumFilterHistoryBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        if (command === 'catalog_view' && !window.__albumFilterReadProbe) {
          try {
            const body = typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body);
            window.__continuousReads.push(JSON.parse(body).query);
          } catch { window.__continuousReads.push({ route: 'unknown' }); }
        }
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__albumFilterReadProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
        if (command === 'catalog_recent') {
          window.__albumFilterHistoryBlocked++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  const probe = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } }));
  expect(probe.readProbe).toBe(true);
  intercepted = true;
  await page.evaluate(() => { window.__albumFilterReadProbe = false; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const model = db.prepare("SELECT target AS id, count(*) AS total FROM refs WHERE owner_kind='albums' AND target_kind='models' GROUP BY target ORDER BY total DESC LIMIT 1").get();
  await page.evaluate(id => { location.hash = `/models/${id}`; }, model.id);
  const grid = page.locator('.virtual-grid');
  await expect(grid).toBeVisible();
  for (let i = 0; i < 30; i++) {
    if (Number(await grid.getAttribute('data-total-items')) === model.total) break;
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(120);
  }
  await expect(grid).toHaveAttribute('data-total-items', String(model.total));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const card = page.locator('.album-card .cover-link').last();
  await page.evaluate(() => {
    window.__modelReadsBefore = window.__continuousReads.filter(q => q.route === 'model').length;
    document.addEventListener('pointerdown', () => { window.__modelOriginY = scrollY; }, { once: true, capture: true });
  });
  await card.click();
  await expect(page.getByRole('button', { name: '返回模特', exact: true })).toBeVisible();
  const photos = page.locator('.album-content-toolbar').getByRole('button', { name: '照片', exact: true });
  if (await photos.count()) await photos.click();
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const media = page.locator('.media-card[data-media-kind="image"] .media-open').first();
  if (await media.count()) {
    await media.click();
    await expect(page.locator('.viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.viewer')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '返回模特', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${model.id}$`));
  await expect.poll(() => page.evaluate(() => Math.abs(scrollY - window.__modelOriginY))).toBeLessThan(2);
  const restored = await page.evaluate(() => ({ scrollDelta: scrollY - window.__modelOriginY,
    readsBefore: window.__modelReadsBefore, readsAfter: window.__continuousReads.filter(q => q.route === 'model').length }));
  expect(restored.readsAfter).toBe(restored.readsBefore);
  expect(snapshot()).toBe(before); expect(errors).toEqual([]);
  await mkdir('verification/album-return-installed', { recursive: true });
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, returnPath: `/models/${model.id}`, modelAlbums: model.total,
    filterAndEditorPreserveOrigin: true, viewerPreservesOrigin: true, restored, catalogUnchanged: true, errors };
  await writeFile('verification/album-return-installed/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.evaluate(() => { location.hash = '/settings'; }).catch(() => {});
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor().catch(() => {});
  await page.evaluate(() => { if (window.__albumFilterOriginalFetch) { window.fetch = window.__albumFilterOriginalFetch; delete window.__albumFilterOriginalFetch; } }).catch(() => {});
  db.close(); await browser.close();
}
