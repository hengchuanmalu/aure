import { readInstalledBuild, catalogSnapshot, connectNative } from '../support/native-session.mjs';
// Read-only acceptance of the reported album in the installed WebView2.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const albumId = process.env.AURE_TEST_ALBUM || '0a60ab82-fa43-47b1-9658-4268cb80e96a';
const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const hash = value => createHash('sha256').update(value).digest('hex');

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const rows = db.prepare("SELECT e.data FROM entities e JOIN refs r ON e.kind=r.target_kind AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.target_kind='media' ORDER BY r.position").all(albumId);
const media = rows.map(row => JSON.parse(row.data));
const originals = async () => {
  const values = [];
  for (const item of media) values.push([item.id, hash(await readFile(item.sourcePath))]);
  return hash(JSON.stringify(values));
};
const originalsBefore = await originals();
const target = media.find(item => item.name === 'c (103).jpg');
expect(target).toBeTruthy();
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
let page;
try {
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('http://tauri.localhost'));
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Visits normally update recent history. Suspend that write for acceptance,
  // restore the real bridge before returning control to the user.
  await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const view = await invoke('catalog_view', { query: { route: 'home', limit: 96, page: 0 } });
    const fetch = window.fetch;
    window.__thumbnailAcceptanceFetch = fetch;
    let reads = 0;
    window.fetch = (input, options) => {
      const url = typeof input === 'string' ? input : input.url || String(input);
      if (url === 'http://ipc.localhost/catalog_view') reads++;
      if (url === 'http://ipc.localhost/catalog_recent') return Promise.resolve(new Response(JSON.stringify(view.db.recent), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
      if (['catalog_operation', 'catalog_patch', 'catalog_reset'].some(command => url === `http://ipc.localhost/${command}`)) return Promise.resolve(new Response(JSON.stringify('Production writes are blocked during thumbnail acceptance'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }));
      return fetch.call(window, input, options);
    };
    await invoke('catalog_view', { query: { route: 'home', limit: 96, page: 0 } });
    if (!reads) throw Error('IPC fetch interception unavailable; do not run production navigation');
  });
  const thumbnails = await page.evaluate(async ids => {
    const results = [];
    for (const id of ids) {
      const url = await window.__TAURI_INTERNALS__.invoke('image_thumbnail', { source: `media:${id}`, edge: 512 });
      const size = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(Error(`Thumbnail failed: ${id}`));
        image.src = url;
      });
      results.push({ id, url, size });
    }
    return results;
  }, media.map(item => item.id));
  expect(thumbnails.length).toBe(media.length);
  for (const thumbnail of thumbnails) expect(Math.max(...thumbnail.size)).toBeLessThanOrEqual(512);
  await page.evaluate(id => { location.hash = `/album/${id}?page=1`; }, albumId);
  const card = page.locator('.media-card').filter({ has: page.getByRole('button', { name: `打开 ${target.name}`, exact: true }) });
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(card.locator('.photo-fallback')).toHaveCount(0);
  await mkdir('verification/large-jpeg-installed', { recursive: true });
  await page.screenshot({ path: 'verification/large-jpeg-installed/thumbnail.png' });
  await card.getByRole('button', { name: `打开 ${target.name}`, exact: true }).click();
  await expect.poll(() => page.locator('.media-stage > img').evaluate(image => [image.complete, image.naturalWidth, image.naturalHeight])).toEqual([true, 11656, 7842]);
  await expect(page.locator('.viewer-error')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  const reloaded = page.locator('.media-card').filter({ has: page.getByRole('button', { name: `打开 ${target.name}`, exact: true }) });
  await reloaded.scrollIntoViewIfNeeded();
  await expect.poll(() => reloaded.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(snapshot()).toBe(before);
  expect(await originals()).toBe(originalsBefore);
  expect(errors).toEqual([]);
  const report = { engine: 'installed Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry,
    thumbnailsDecoded: thumbnails.length, thumbnailFailures: 0, reportedImage: target.name,
    thumbnailSize: thumbnails.find(item => item.id === target.id).size, originalSize: [11656, 7842],
    originalViewer: true, thumbnailAfterReturning: true, catalogUnchanged: true, allOriginalHashesUnchanged: true, errors };
  await writeFile('verification/large-jpeg-installed/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (page) await page.evaluate(() => {
    if (window.__thumbnailAcceptanceFetch) window.fetch = window.__thumbnailAcceptanceFetch;
    delete window.__thumbnailAcceptanceFetch;
  });
  db.close();
  await browser.close();
}
