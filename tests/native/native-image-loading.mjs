import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed WebView2 acceptance. Catalog mutations and history writes are guarded.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const install = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(install);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const album = db.prepare('SELECT album,images,videos FROM summaries WHERE images>1 AND videos>0 ORDER BY images+videos LIMIT 1').get();
if (!album) throw Error('No mixed real album for acceptance');
const sequence = db.prepare("SELECT e.id,e.media_kind AS kind FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY (e.media_kind='video'),r.position").all(album.album);
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('Installed WebView2 unavailable');
page.setDefaultTimeout(20000);
const originalRoute = await page.evaluate(() => location.hash);
const route = value => page.evaluate(value => { location.hash = value; }, value);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let guard = false;
let releaseOriginal;
let heldOriginal;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  await route('/settings');
  await expect(page.locator('.settings-page')).toBeVisible();
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__loadingOriginalFetch = original;
    window.__loadingProbe = true;
    window.__loadingBlockedHistory = 0;
    window.__loadingGate = new Promise(resolve => { window.__releaseLoading = resolve; });
    window.__holdThumbnails = true;
    window.fetch = async (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__loadingProbe) return new Response(JSON.stringify({ readProbe: true }), { headers });
        if (command === 'catalog_recent') {
          window.__loadingBlockedHistory++;
          return new Response(JSON.stringify(recent), { headers });
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command))
          return new Response(JSON.stringify('Read-only image-loading acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } });
        if (command === 'image_thumbnail' && window.__holdThumbnails) await window.__loadingGate;
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: {} }))).readProbe).toBe(true);
  guard = true;
  await page.evaluate(() => { window.__loadingProbe = false; });
  await mkdir('verification/image-loading-installed', { recursive: true });
  await route('/library?view=stack');
  const cover = page.locator('.fan-front .photo-frame').first();
  await expect(cover).toHaveAttribute('data-photo-state', 'loading');
  await expect(cover.locator('img')).toHaveCSS('visibility', 'hidden');
  const stackBox = await cover.boundingBox();
  expect(await cover.evaluate(element => getComputedStyle(element, '::before').backgroundImage)).toContain('aure-placeholder.webp');
  await page.screenshot({ path: 'verification/image-loading-installed/stack-loading.png' });
  await route(`/album/${album.album}`);
  const firstPhoto = page.locator('[data-media-kind="image"] .photo-frame').first();
  await expect(firstPhoto).toHaveAttribute('data-photo-state', 'loading');
  await page.screenshot({ path: 'verification/image-loading-installed/photos-loading.png' });
  await page.evaluate(() => { window.__holdThumbnails = false; window.__releaseLoading(); });
  await expect(firstPhoto).toHaveAttribute('data-photo-state', 'ready');
  const videoCover = page.locator('[data-media-kind="video"] .photo-frame').first();
  await videoCover.scrollIntoViewIfNeeded();
  await expect(videoCover).toHaveAttribute('data-photo-state', 'ready');
  await expect(videoCover.locator('img')).toHaveCSS('visibility', 'visible');

  // Delay actual original requests to observe the installed loading state.
  let resumeOriginal;
  const originalGate = new Promise(resolve => { resumeOriginal = resolve; });
  releaseOriginal = resumeOriginal;
  heldOriginal = async request => { await originalGate; await request.continue(); };
  await page.route('http://jingji.localhost/media/**', heldOriginal);
  await route(`/viewer/${album.album}/${sequence[0].id}`);
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'loading');
  await expect(page.locator('.media-stage > img')).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: 'verification/image-loading-installed/viewer-loading.png' });
  releaseOriginal();
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready');
  await page.unroute('http://jingji.localhost/media/**', heldOriginal);
  const imageSize = await page.locator('.media-stage > img').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  expect(imageSize.width).toBeGreaterThan(0);
  await page.screenshot({ path: 'verification/image-loading-installed/viewer-ready.png' });
  const videoId = sequence.find(item => item.kind === 'video').id;
  await route(`/viewer/${album.album}/${videoId}`);
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready', { timeout: 60000 });
  const videoSize = await page.locator('.media-stage > video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight }));
  expect(videoSize.width).toBeGreaterThan(0);
  await expect(page.locator('.viewer-media-placeholder')).toHaveCount(0);
  await page.screenshot({ path: 'verification/image-loading-installed/video-ready.png' });
  const resource = await page.evaluate(async () => {
    const entries = performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/media/aure-placeholder.webp'));
    const image = new Image();
    image.src = '/media/aure-placeholder.webp';
    await image.decode();
    return { requestsBeforeProbe: entries.length, width: image.naturalWidth, height: image.naturalHeight };
  });
  resource.bytes = (await readFile('public/media/aure-placeholder.webp')).byteLength;
  expect(resource.requestsBeforeProbe).toBe(1);
  expect(resource.bytes).toBe(1114);
  expect(resource.width).toBe(256);
  expect(errors).toEqual([]);
  expect(snapshot()).toBe(before);
  const result = { engine: 'installed Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry, asset: resource, stackPlaceholder: true, stackBox, photoPlaceholder: true, videoCover: true, originalLoadingHidden: true, imageSize, videoSize, catalogUnchanged: true, errors };
  await writeFile('verification/image-loading-installed/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  releaseOriginal?.();
  if (heldOriginal) await page.unroute('http://jingji.localhost/media/**', heldOriginal).catch(() => {});
  if (guard) {
    await page.evaluate(() => { window.__holdThumbnails = false; window.__releaseLoading?.(); }).catch(() => {});
    await route(originalRoute.startsWith('#/viewer/') ? '/library' : originalRoute || '/').catch(() => {});
    await page.locator('.viewer').waitFor({ state: 'detached' }).catch(() => {});
    await page.evaluate(() => {
      window.fetch = window.__loadingOriginalFetch;
      delete window.__loadingOriginalFetch;
      delete window.__loadingProbe;
      delete window.__loadingGate;
      delete window.__releaseLoading;
      delete window.__holdThumbnails;
    }).catch(() => {});
  }
  expect(snapshot()).toBe(before);
  db.close();
  await browser.close();
}
