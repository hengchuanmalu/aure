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
const albums = db.prepare('SELECT album,images,videos FROM summaries').all();
const cases = [albums.find(a => a.images > 0 && a.videos === 0), albums.find(a => a.images === 0 && a.videos > 0), albums.find(a => a.images > 0 && a.videos > 0), albums.find(a => a.images === 0 && a.videos === 0)].filter(Boolean);
if (!cases.length) throw Error('No albums available for read-only acceptance');
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
page.setDefaultTimeout(10000);
let intercepted = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__albumFilterOriginalFetch = original;
    window.__albumFilterReadProbe = true;
    window.__albumFilterHistoryBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
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
  const results = [];
  const tabs = page.locator('.album-content-toolbar .tabs');
  for (const album of cases) {
    await page.evaluate(id => { location.hash = `/album/${encodeURIComponent(id)}`; }, album.album);
    await expect(tabs.getByRole('button', { name: '全部内容', exact: true })).toHaveCount(album.images > 0 && album.videos > 0 ? 1 : 0);
    await expect(tabs.getByRole('button', { name: '照片', exact: true })).toHaveCount(album.images > 0 ? 1 : 0);
    await expect(tabs.getByRole('button', { name: '视频', exact: true })).toHaveCount(album.videos > 0 ? 1 : 0);
    await mkdir('verification/album-content-filters', { recursive: true });
    await tabs.screenshot({ path: `verification/album-content-filters/installed-${album.images > 0 ? 'photos' : ''}${album.videos > 0 ? 'videos' : ''}.png` });
    if (album.images > 0 && album.videos > 0) {
      await tabs.getByRole('button', { name: '照片', exact: true }).click();
      await expect(tabs.getByRole('button', { name: '视频', exact: true })).toBeVisible();
      await tabs.getByRole('button', { name: '视频', exact: true }).click();
      await expect(tabs.getByRole('button', { name: '照片', exact: true })).toBeVisible();
    } else {
      await page.evaluate(({ id, type }) => { location.hash = `/album/${encodeURIComponent(id)}?type=${type}&page=2`; }, { id: album.album, type: album.images > 0 ? 'video' : 'image' });
      await expect.poll(() => page.evaluate(() => location.hash.includes('type='))).toBe(false);
      if (album.images > 0 || album.videos > 0) await expect(tabs.getByRole('button', { name: album.images > 0 ? '照片' : '视频', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    results.push({ images: album.images, videos: album.videos, passed: true });
  }
  expect(await page.evaluate(() => window.__albumFilterHistoryBlocked)).toBeGreaterThan(0);
  expect(snapshot()).toBe(before);
  await mkdir('verification/album-content-filters', { recursive: true });
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, results, unavailableFilterRecovery: true, catalogUnchanged: true };
  await writeFile('verification/album-content-filters/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (intercepted) {
    await page.evaluate(() => { location.hash = '/'; }).catch(() => {});
    await page.getByRole('heading', { name: '发现', exact: true }).waitFor().catch(() => {});
  }
  await page.evaluate(() => { if (window.__albumFilterOriginalFetch) { window.fetch = window.__albumFilterOriginalFetch; delete window.__albumFilterOriginalFetch; delete window.__albumFilterReadProbe; delete window.__albumFilterHistoryBlocked; } }).catch(() => {});
  db.close(); await browser.close();
}
