import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed WebView2 acceptance; catalog mutations and recent writes are blocked.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { writeFile, mkdir } from 'node:fs/promises';

import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const album = db.prepare('SELECT album,images,videos FROM summaries WHERE images>0 AND videos>0 ORDER BY (images+videos>48) DESC, images+videos LIMIT 1').get();
if (!album) throw Error('Installed catalog has no mixed album for acceptance');
const sequence = db.prepare("SELECT e.id,e.media_kind AS kind FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY (e.media_kind='video'),r.position").all(album.album);
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('Installed WebView2 page unavailable');
page.setDefaultTimeout(15000);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let protectedHistory = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__viewerOriginalFetch = original;
    window.__viewerProbe = true;
    window.__viewerBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__viewerProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
        if (command === 'catalog_recent') {
          window.__viewerBlocked++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command))
          return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: {} }))).readProbe).toBe(true);
  protectedHistory = true;
  await page.evaluate(() => { window.__viewerProbe = false; });
  const route = hash => page.evaluate(hash => { location.hash = hash; }, hash);
  await mkdir('verification/viewer-redesign', { recursive: true });
  await route(`/viewer/${album.album}/${sequence[0].id}`);
  const selected = page.locator('.viewer-thumbnail[aria-current=true]');
  await expect(selected).toHaveAttribute('data-media-id', sequence[0].id);
  await expect.poll(() => page.locator('.media-stage > img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect.poll(() => selected.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.locator('.viewer-top').evaluate(el => el.getBoundingClientRect().height)).toBe(48);
  expect(await page.locator('.viewer-thumbnail').count()).toBeLessThan(32);
  const floatingRail = page.locator('.viewer-filmstrip');
  const floatingBox = await floatingRail.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(floatingBox.x).toBeGreaterThan(0);
  expect(floatingBox.x + floatingBox.width).toBeLessThan(viewport.width);
  expect(floatingBox.y + floatingBox.height).toBeLessThan(viewport.height);
  expect(await floatingRail.evaluate(el => parseFloat(getComputedStyle(el).borderRadius))).toBeGreaterThan(0);
  const stageBox = await page.locator('.media-stage').boundingBox();
  await page.mouse.move(viewport.width / 2, floatingBox.y + floatingBox.height / 2);
  await expect(floatingRail).toHaveCSS('opacity', '1');
  expect(await page.locator('.viewer-filmstrip-scroll').evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  expect(await page.locator('.viewer-filmstrip [title]').count()).toBe(0);
  await page.screenshot({ path: 'verification/viewer-redesign/installed-photo.png' });
  await page.mouse.move(viewport.width / 2, 300);
  await expect(floatingRail).toHaveCSS('opacity', '0');
  expect(await page.locator('.media-stage').boundingBox()).toEqual(stageBox);
  await page.screenshot({ path: 'verification/viewer-redesign/installed-photo-hidden.png' });
  await page.mouse.move(viewport.width / 2, viewport.height - 2);
  await expect(floatingRail).toHaveCSS('opacity', '1');
  const rail = page.getByLabel('滚动浏览缩略图', { exact: true });
  await rail.focus();
  await page.keyboard.press('End');
  await expect(page.locator(`.viewer-thumbnail[data-media-id="${sequence.at(-1).id}"]`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/viewer/${album.album}/${sequence[0].id}$`));
  // The remote rail must select a video without widening or reordering the sequence.
  const videoId = sequence[album.images].id;
  await route(`/viewer/${album.album}/${sequence[album.images - 1].id}`);
  await expect(selected).toHaveAttribute('data-media-id', sequence[album.images - 1].id);
  await page.locator(`.viewer-thumbnail[data-media-id="${videoId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/viewer/${album.album}/${videoId}$`));
  await expect(selected).toHaveAttribute('data-media-id', videoId);
  const video = page.locator('.media-stage video');
  await expect.poll(() => video.evaluate(video => video.readyState), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
  if (await video.evaluate(video => video.paused)) await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(0.1);
  await page.getByLabel('播放进度', { exact: true }).fill('1');
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(0.9);
  const initialVolume = await video.evaluate(video => video.volume);
  if (initialVolume === 0) await page.getByRole('button', { name: '取消静音', exact: true }).click();
  await page.getByRole('button', { name: '静音', exact: true }).click();
  expect(await video.evaluate(video => video.volume)).toBe(0);
  await page.screenshot({ path: 'verification/viewer-redesign/installed-video.png' });
  await page.getByLabel('音量', { exact: true }).fill(String(initialVolume));
  await page.getByRole('group', { name: '显示写真集缩略图', exact: true }).press('Enter');
  await expect(floatingRail).toHaveCSS('opacity', '1');
  await page.locator('.viewer-thumbnail[aria-current=true]').press('Alt+ArrowLeft');
  await expect(selected).toHaveAttribute('data-media-id', sequence[album.images - 1].id);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.locator('.media-stage > img').click();
  await expect(page.locator('.viewer')).toHaveClass(/viewer-fullscreen/);
  await expect(page.locator('.viewer-controls')).toHaveCSS('opacity', '0', { timeout: 5000 });
  await page.mouse.move(700, 300);
  await expect(page.locator('.viewer-controls')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).not.toHaveClass(/viewer-fullscreen/);
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '媒体信息', exact: true }).click();
  await expect(page.locator('.info-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.info-panel')).toHaveCount(0);
  await route(`/album/${album.album}?type=video`);
  await page.locator(`.media-card[data-media-id="${videoId}"]`).click();
  await expect(selected).toHaveAttribute('data-media-id', videoId);
  await expect(page.locator('.viewer-position')).toHaveText(`1 / ${album.videos}`);
  expect(await page.locator('.viewer-thumbnail').count()).toBeLessThanOrEqual(32);
  expect(await page.locator('.viewer-thumbnail').count()).toBeGreaterThan(0);
  expect(await page.locator('.viewer-thumbnail-video').count()).toBe(await page.locator('.viewer-thumbnail').count());
  await page.locator('.viewer-thumbnail[aria-current=true]').focus();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/type=video$/);
  expect(await page.evaluate(() => window.__viewerBlocked)).toBeGreaterThan(0);
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry,
    images: album.images, videos: album.videos, boundedContinuousRail: true, thumbnailsDecoded: true,
    videoPlaybackSeekMute: true, fullscreenHideEscape: true, floatingRoundedRail: true, pointerExitFadeAndBottomReveal: true,
    stableMediaSize: true, scrollbarHidden: true, thumbnailHoverTitlesRemoved: true,
    sourceFilterPreserved: true, catalogUnchanged: true, errors };
  await writeFile('verification/viewer-redesign/installed-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (protectedHistory) {
    await page.evaluate(async hash => {
      try { await window.__TAURI_INTERNALS__.invoke('plugin:window|set_fullscreen', { label: 'main', value: false }); }
      finally { location.hash = hash.startsWith('#/viewer/') ? '/' : hash || '/'; }
    }, originalHash).catch(() => {});
    await page.locator('.viewer').waitFor({ state: 'detached' }).catch(() => {});
    await page.evaluate(() => { if (window.__viewerOriginalFetch) window.fetch = window.__viewerOriginalFetch;
      delete window.__viewerOriginalFetch; delete window.__viewerProbe; delete window.__viewerBlocked; }).catch(() => {});
  }
  expect(snapshot()).toBe(before);
  db.close();
  await browser.close();
}
