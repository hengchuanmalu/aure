import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance against the installed production catalog and WebView2.
import { expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(root);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'json');
const before = snapshot();
const album = db.prepare('SELECT album,images,videos FROM summaries WHERE images>0 AND videos>0 AND images%5<>0 AND images+videos<=96 ORDER BY images+videos LIMIT 1').get();
if (!album) throw Error('No mixed album available for installed acceptance');
const sequence = db.prepare("SELECT e.id,e.media_kind AS kind,r.position FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY (e.media_kind='video'),r.position").all(album.album);
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('Installed WebView2 page unavailable');
page.setDefaultTimeout(10000);
let protectedHistory = false;
const originalView = await page.evaluate(() => localStorage.getItem('aure.media-view.v1'));
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__orderOriginalFetch = original;
    window.__orderProbe = true;
    window.__orderHistoryBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__orderProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
        if (command === 'catalog_recent') {
          window.__orderHistoryBlocked++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: {} }))).readProbe).toBe(true);
  protectedHistory = true;
  await page.evaluate(() => { window.__orderProbe = false; });
  const invokeView = query => page.evaluate(query => window.__TAURI_INTERNALS__.invoke('catalog_view', { query }), query);
  const pageIndices = [...new Set([0, Math.floor((album.images - 1) / 96), Math.floor(album.images / 96), Math.floor((sequence.length - 1) / 96)])];
  for (const index of pageIndices) {
    const result = await invokeView({ route: 'album', id: album.album, page: index, limit: 96, kind: 'all' });
    expect(result.visibleMediaIds).toEqual(sequence.slice(index * 96, (index + 1) * 96).map(item => item.id));
    expect(result.db.albums[0].mediaIds).toEqual(sequence.map(item => item.id));
  }
  for (const kind of ['all', 'image', 'video']) {
    const items = sequence.filter(item => kind === 'all' || item.kind === kind);
    const indices = [...new Set([0, items.length - 1, ...(kind === 'all' ? [album.images - 1, album.images] : [])])];
    for (const index of indices) {
      const result = await invokeView({ route: 'viewer', owner: album.album, id: items[index].id, kind });
      expect(result.viewer).toEqual({ index, total: items.length, previous: items[index - 1]?.id ?? null, next: items[index + 1]?.id ?? null });
    }
  }
  await page.evaluate(id => { location.hash = `/album/${id}`; }, album.album);
  await expect(page.getByRole('button', { name: '浏览写真', exact: true })).toBeVisible();
  const cards = page.locator('.media-card');
  await expect(cards.first()).toHaveAttribute('data-media-id', sequence[0].id);
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-media-id')));
  const positions = ids.map(id => sequence.findIndex(item => item.id === id));
  expect(positions.every((index, i) => i === 0 || index > positions[i - 1])).toBe(true);
  await mkdir('verification/album-media-order', { recursive: true });
  await page.getByRole('button', { name: '自适应视图', exact: true }).click();
  const slider = page.getByRole('slider', { name: '每行照片数', exact: true });
  await slider.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('5');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const lastPhoto = page.locator(`[data-media-id="${sequence[album.images - 1].id}"]`);
  const firstVideo = page.locator(`[data-media-id="${sequence[album.images].id}"]`);
  await expect(lastPhoto).toBeVisible();
  await expect(firstVideo).toBeVisible();
  await expect.poll(() => page.evaluate(({ photoId, videoId }) => {
    const photo = document.querySelector(`[data-media-id="${photoId}"]`).getBoundingClientRect();
    const video = document.querySelector(`[data-media-id="${videoId}"]`).getBoundingClientRect();
    return Math.abs(photo.top - video.top) < 1 && video.left > photo.right;
  }, { photoId: sequence[album.images - 1].id, videoId: sequence[album.images].id })).toBe(true);
  await page.screenshot({ path: 'verification/album-media-order/installed.png' });
  await page.getByRole('button', { name: '浏览写真', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viewer/${album.album}/${sequence[0].id}$`));
  await expect(page.locator('.media-stage > img')).toBeVisible();
  // The last photo must advance to the first video in the actual native viewer.
  await page.evaluate(({ albumId, id }) => { location.hash = `/viewer/${albumId}/${id}`; }, { albumId: album.album, id: sequence[album.images - 1].id });
  await page.mouse.move(600, 300);
  await expect(page.locator('.viewer-controls')).toContainText(`${album.images} / ${sequence.length}`);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page).toHaveURL(new RegExp(`/viewer/${album.album}/${sequence[album.images].id}$`));
  await expect(page.locator('.media-stage video')).toBeAttached();
  await page.mouse.move(600, 300);
  await expect(page.locator('.viewer-controls')).toContainText(`${album.images + 1} / ${sequence.length}`);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/viewer/${album.album}/${sequence[album.images - 1].id}$`));
  expect(await page.evaluate(() => window.__orderHistoryBlocked)).toBeGreaterThan(0);
  expect(snapshot()).toBe(before);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, images: album.images, videos: album.videos, pageIndices, videosFillLastPhotoRow: true, photoVideoBoundary: true, browseEntry: true, catalogUnchanged: true };
  await writeFile('verification/album-media-order/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (protectedHistory) {
    await page.evaluate(() => { location.hash = '/'; }).catch(() => {});
    await page.getByRole('heading', { name: '发现', exact: true }).waitFor().catch(() => {});
  }
  await page.evaluate(() => { if (window.__orderOriginalFetch) { window.fetch = window.__orderOriginalFetch; delete window.__orderOriginalFetch; delete window.__orderProbe; delete window.__orderHistoryBlocked; } }).catch(() => {});
  await page.evaluate(value => { value === null ? localStorage.removeItem('aure.media-view.v1') : localStorage.setItem('aure.media-view.v1', value); }, originalView).catch(() => {});
  db.close();
  await browser.close();
}
