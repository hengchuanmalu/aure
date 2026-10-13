import { connectNative } from '../support/native-session.mjs';
// Build with the isolated identifier local.aure.import-repro and expose WebView CDP.
// This test never changes the user's catalog or original media.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9224', "local.aure.import-repro");
try {
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  if (await invoke('plugin:app|identifier') !== 'local.aure.import-repro') throw Error('Refusing a non-test catalog');
  const dataDir = await invoke('plugin:path|resolve_directory', { directory: 14 });
  const root = resolve('verification/native-thumbnails/中文 图集【3P】');
  await mkdir(root, { recursive: true });
  const fixture = resolve('tests/fixtures/media/p-774909.jpg');
  const media = [];
  for (let i = 0; i < 3; i++) {
    const sourcePath = join(root, `${i + 1}.jpg`);
    if (i === 2) await writeFile(sourcePath, 'broken');
    else await copyFile(fixture, sourcePath);
    media.push({ id: `thumbnail-${i}`, sourcePath, src: `http://asset.localhost/${encodeURIComponent(sourcePath)}`, kind: 'image', name: `${i + 1}.jpg`, width: 0, height: 0, size: (await stat(sourcePath)).size, tags: [], favorite: false, liked: false, rating: 0 });
  }
  const hashes = await Promise.all(media.slice(0, 2).map(async m => createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')));
  await invoke('catalog_reset', { seed: { version: 1, media, albums: [{ id: 'thumbnail-album', name: '缩略图回归', subtitle: '', description: '', cover: media[0].src, coverMediaId: media[0].id, mediaIds: media.map(m => m.id), tags: [], modelIds: ['thumbnail-model'], favorite: false, createdAt: '2026-10-04', updatedAt: '2026-10-04' }], models: [{ id: 'thumbnail-model', name: '测试模特', alias: '', bio: '', avatar: media[1].src, background: media[1].src, avatarFocus: 50, backgroundFocus: 50, photoIds: [], fields: [], links: [] }], tags: [], groups: [], recent: [], settings: { reducedMotion: false } } });
  const db = new DatabaseSync(join(dataDir, 'catalog.sqlite3'));
  for (const m of media) db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(m.sourcePath.replaceAll('\\', '/').toLowerCase());
  db.close();
  const originals = [];
  page.on('request', r => { if (r.url().startsWith('http://jingji.localhost/media/')) originals.push(r.url()); });
  await page.goto('http://tauri.localhost/#/album/thumbnail-album');
  await page.reload(); // resetting the native fixture does not update an already mounted view
  await expect(page.locator('[data-media-id="thumbnail-0"] img')).toHaveJSProperty('naturalHeight', 512);
  await expect(page.locator('[data-media-id="thumbnail-1"] img')).toHaveJSProperty('naturalHeight', 512);
  const visible = page.locator('img[src^="http://jingji.localhost/thumbnail/"]');
  await expect(visible).toHaveCount(4); // cover, avatar and two valid media
  expect(originals).toEqual([]);
  const resource = await invoke('image_thumbnail', { source: 'media:thumbnail-0' });
  expect(resource).toMatch(/^http:\/\/jingji\.localhost\/thumbnail\/[a-f0-9]{64}$/);
  const probe = url => page.evaluate(url => new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = url;
  }), url);
  expect(await probe(resource)).toBe(true);
  const cacheDir = await invoke('plugin:path|resolve_directory', { directory: 16 });
  const rawPath = join(cacheDir, 'thumbnails-v1', resource.split('/').at(-1) + '.jpg');
  const assetURL = await page.evaluate(path => window.__TAURI_INTERNALS__.convertFileSrc(path), rawPath);
  expect(await probe(assetURL)).toBe(false); // no asset grant; custom resource still succeeds
  expect(await probe('http://jingji.localhost/thumbnail/%2e%2e%2foriginal.jpg')).toBe(false);
  expect(await probe('http://jingji.localhost/thumbnail/' + 'b'.repeat(64))).toBe(false);
  await expect(page.locator('[data-media-id="thumbnail-2"] .photo-fallback')).toBeVisible();
  await copyFile(fixture, media[2].sourcePath);
  await page.getByRole('button', { name: '重试缩略图 3.jpg', exact: true }).click();
  await expect(page.locator('[data-media-id="thumbnail-2"] img')).toHaveJSProperty('naturalHeight', 512);
  await page.reload();
  await expect(page.locator('[data-media-id="thumbnail-0"] img')).toHaveJSProperty('naturalHeight', 512);
  await expect(page.locator('[data-media-id="thumbnail-2"] img')).toHaveJSProperty('naturalHeight', 512);
  for (let i = 0; i < 2; i++) expect(createHash('sha256').update(await readFile(media[i].sourcePath)).digest('hex')).toBe(hashes[i]);
  const originalsLoadedInList = originals.length;
  await page.getByRole('button', { name: '打开 1.jpg', exact: true }).click();
  await expect.poll(() => page.locator('.media-stage > img').evaluate(i => i.naturalHeight)).toBeGreaterThan(512);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  console.log(JSON.stringify({ cover: true, avatar: true, media: true, reload: true, retry: true, originalViewer: true, assetGrantRequired: false, originalsLoadedInList, originalHashesUnchanged: true }));
} finally { await browser.close(); }
