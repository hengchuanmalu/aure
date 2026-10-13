// Metadata scale: real decoding and process cold start are separate tests.
import { connectNative, nativePage, isolatedIdentifier, invokeNative } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { largeLibrary } from '../support/large-library.fixture.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, totalmem, release } from 'node:os';

const identifier = isolatedIdentifier('local.jingji.performance-audit');
const browser = await connectNative('http://127.0.0.1:9223', identifier);
const page = nativePage(browser);
const output = resolve('verification/native-desktop');
await mkdir(output, { recursive: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
const invoke = (command, args) => invokeNative(page, command, args);
try {
  for (const [albums, media] of [[1000, 100000], [5000, 300000]]) {
    const seed = largeLibrary(albums, media);
    seed.albums[0].mediaIds = seed.media.slice(0, 500).map(item => item.id);
    const start = performance.now();
    await invoke('catalog_reset', { seed });
    const fixtureMs = performance.now() - start;
    await page.goto('http://tauri.localhost/#/library');
    // Direct fixture IPC bypasses the Provider's reset/refresh operation.
    // Start a fresh page session for this catalog instead of reusing its cache.
    await page.reload();
    await expect(page.locator('.library-results')).toContainText(albums + ' 本');
    await expect(page.locator('.album-card').first()).toBeVisible();
    expect(await page.locator('.album-card').count()).toBeLessThan(100);
    await expect(page.getByRole('navigation', { name: '图库分页' })).toHaveCount(0);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Number(await page.locator('.album-grid').getAttribute('data-total-items'))).toBeGreaterThan(96);
    expect(await page.locator('.album-card').count()).toBeLessThan(100);
    const needle = '写真 ' + String(albums - 1).padStart(5, '0');
    const search = page.getByRole('combobox', { name: '搜索写真、模特或标签', exact: true });
    await search.fill(needle);
    await search.press('Enter');
    await expect(page.locator('.album-card')).toHaveCount(1);
    await expect(page.getByRole('link', { name: '打开写真 ' + needle, exact: true })).toBeVisible();
    await page.goto('http://tauri.localhost/#/album/album-0');
    await expect(page.locator('.media-card').first()).toBeVisible();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Number(await page.locator('.media-layout').getAttribute('data-total-items'))).toBeGreaterThan(96);
    expect(await page.locator('.media-card').count()).toBeLessThan(100);
    await expect(page.locator('.album-media-pager, .picker-pages')).toHaveCount(0);
    const distant = await invoke('catalog_view', { query: { route: 'album', id: 'album-0', limit: 96, page: 5 } });
    expect(distant.visibleMediaIds.at(-1)).toBe('media-499');
    await page.goto('http://tauri.localhost/#/favorites?tab=media');
    await expect(page.getByRole('button', { name: '照片与视频 · ' + media })).toBeVisible();
    await expect(page.locator('.media-card').first()).toBeVisible();
    expect(await page.locator('.media-card').count()).toBeLessThan(100);
    const samples = [];
    for (let index = 0; index < 20; index++) {
      const begin = performance.now();
      const value = await invoke('catalog_view', { query: { route: 'library', sort: 'name', limit: 96, page: index % 10 } });
      samples.push(performance.now() - begin);
      expect(value.db.albums.length).toBeLessThanOrEqual(96);
      expect(value.db.albums.length).toBeGreaterThan(0);
      expect(value.db.media.length).toBeLessThanOrEqual(480);
    }
    samples.sort((a, b) => a - b);
    results.push({ albums, media, fixtureMs, searchBridgeP95Ms: samples[18], continuousWindows: true, boundedDOM: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ identifier, engine: 'Windows WebView2',
    metadataOnly: true, hardware: { cpu: cpus()[0]?.model, physicalMemoryBytes: totalmem(), windowsRelease: release() },
    cache: 'warm OS/database cache; excludes process cold start and real-media I/O', results, errors }, null, 2));
} finally { await browser.close(); }
