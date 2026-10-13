import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Real installed WebView2; catalog/history writes blocked for read-only acceptance.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const install = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(install);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const album = db.prepare("SELECT s.album FROM summaries s JOIN entities e ON e.kind='albums' AND e.id=s.album WHERE s.images>=25 ORDER BY (json_extract(e.data,'$.name')='月光猫骑士') DESC, s.images LIMIT 1").get();
if (!album) throw Error('No real album with enough photos');
const media = db.prepare("SELECT e.id FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' AND e.media_kind='image' ORDER BY r.position").all(album.album);
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('Installed page missing');
page.setDefaultTimeout(15000);
const originalRoute = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let guarded = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__stabilityFetch = original;
    window.__stabilityProbe = true;
    window.__candidateReads = 0;
    window.fetch = async (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__stabilityProbe) return new Response(JSON.stringify({ readProbe: true }), { headers });
        if (command === 'catalog_recent') return new Response(JSON.stringify(recent), { headers });
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command))
          return new Response(JSON.stringify('Read-only filmstrip acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } });
        if (command === 'catalog_candidates') window.__candidateReads++;
        if (command === 'catalog_view') await new Promise(resolve => setTimeout(resolve, 350));
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: {} }))).readProbe).toBe(true);
  guarded = true;
  await page.evaluate(() => { window.__stabilityProbe = false; });
  await page.evaluate(route => { location.hash = route; }, `/viewer/${album.album}/${media[19].id}`);
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', media[19].id);
  const anchorSelector = `.viewer-thumbnail[data-media-id="${media[19].id}"]`;
  const anchor = page.locator(anchorSelector);
  await expect(anchor.locator('.photo-frame')).toHaveAttribute('data-photo-state', 'ready');
  await page.locator('.viewer-filmstrip-zone').hover();
  await page.evaluate(selector => {
    window.__stabilityRail = document.querySelector('.viewer-filmstrip');
    window.__stabilityImage = document.querySelector(`${selector} img`);
    window.__stabilityBaseline = window.__candidateReads;
    window.__stabilityFlashes = 0;
    window.__stabilityRemovals = 0;
    window.__stabilityObserver = new MutationObserver(() => {
      if (!window.__stabilityRail.isConnected) window.__stabilityRemovals++;
      if (!window.__stabilityImage.isConnected || window.__stabilityImage.closest('.photo-frame').dataset.photoState !== 'ready') window.__stabilityFlashes++;
    });
    window.__stabilityObserver.observe(document.querySelector('#root'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-photo-state'] });
  }, anchorSelector);
  for (const index of [22, 18, 19, 23]) {
    await page.mouse.move(500, 300);
    await page.locator('.viewer-filmstrip-zone').hover();
    await page.locator(`.viewer-thumbnail[data-media-id="${media[index].id}"]`).click();
    await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', media[index].id);
    await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready');
  }
  const result = await page.evaluate(selector => {
    window.__stabilityObserver.disconnect();
    return { sameRailNode: window.__stabilityRail === document.querySelector('.viewer-filmstrip'),
      sameDecodedImageNode: window.__stabilityImage === document.querySelector(`${selector} img`),
      flashes: window.__stabilityFlashes, removals: window.__stabilityRemovals,
      candidateReadsBefore: window.__stabilityBaseline, candidateReadsAfter: window.__candidateReads };
  }, anchorSelector);
  console.log(JSON.stringify(result, null, 2));
  expect(result.sameRailNode).toBe(true);
  expect(result.sameDecodedImageNode).toBe(true);
  expect(result.flashes).toBe(0);
  expect(result.removals).toBe(0);
  expect(result.candidateReadsAfter).toBe(result.candidateReadsBefore);
  const rail = page.locator('.viewer-filmstrip');
  await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('border-width', '0px');
  await expect(rail).toHaveCSS('box-shadow', 'none');
  await expect(rail.getByRole('button', { name: /滚动缩略图/ })).toHaveCount(0);
  await expect(rail.locator('[title]')).toHaveCount(0);
  await page.getByRole('group', { name: '显示写真集缩略图' }).press('Enter');
  const scroll = page.getByLabel('滚动浏览缩略图', { exact: true });
  await scroll.press('End');
  await expect.poll(() => scroll.evaluate(el => Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth))).toBeLessThan(1);
  const last = page.locator(`.viewer-thumbnail[data-media-id="${media.at(-1).id}"]`);
  const beforeHover = await last.boundingBox();
  await last.hover();
  await expect(last).toHaveCSS('scale', '1.08');
  const afterHover = await last.boundingBox();
  expect(Math.abs(afterHover.x + afterHover.width / 2 - beforeHover.x - beforeHover.width / 2)).toBeLessThan(1);
  expect(Math.abs(afterHover.y + afterHover.height - beforeHover.y - beforeHover.height)).toBeLessThan(1);
  await expect(last.locator('.photo-frame')).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.333) 0px 4px 10px 0px');
  await mkdir('verification/filmstrip-stability-installed', { recursive: true });
  await page.screenshot({ path: 'verification/filmstrip-stability-installed/hover-last.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(last).toHaveCSS('scale', '1');
  await expect(last).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.media-stage').hover({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: '返回详情', exact: true }).focus();
  await expect(rail).toHaveCSS('opacity', '0');
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  await mkdir('verification/filmstrip-stability-installed', { recursive: true });
  await page.screenshot({ path: 'verification/filmstrip-stability-installed/after-switches.png' });
  await writeFile('verification/filmstrip-stability-installed/results.json', JSON.stringify({ engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, delayedMetadataMs: 350, thumbnailClicks: 4, ...result, transparentRail: true, arrowsRemoved: true, stableHover: true, reducedMotion: true, pointerExitFade: true, catalogUnchanged: true, errors }, null, 2));
} finally {
  if (guarded) {
    await page.evaluate(hash => { window.__stabilityObserver?.disconnect(); location.hash = hash.startsWith('#/viewer/') ? '/library' : hash || '/'; }, originalRoute).catch(() => {});
    await page.locator('.viewer').waitFor({ state: 'detached' }).catch(() => {});
    await page.evaluate(() => { window.fetch = window.__stabilityFetch; delete window.__stabilityFetch; delete window.__stabilityProbe; }).catch(() => {});
  }
  expect(snapshot()).toBe(before);
  db.close();
  await browser.close();
}
