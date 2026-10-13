// Release boundary checks use copied fixtures and an explicitly isolated catalog.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { catalogSnapshot, connectNative, invokeNative, nativePage } from '../support/native-session.mjs';

const identifier = process.env.AURE_NATIVE_IDENTIFIER || 'local.jingji.user-journey-audit';
if (!/^local\.jingji\.[a-z-]*(?:audit|test)$/.test(identifier) || identifier === 'local.jingji.desktop')
  throw Error('Boundary writes require an isolated audit/test identifier');
const output = resolve('verification/native-release-boundaries');
const fixtureRoot = join(output, randomUUID());
const longDirectory = join(fixtureRoot, ...Array.from({ length: 5 }, (_, i) => `中文路径-${i}-${'目录'.repeat(14)}`));
await mkdir(longDirectory, { recursive: true });
const sourcePath = join(longDirectory, '写真-🌸-只读.jpg');
await copyFile(resolve('tests/fixtures/media/p-1239291.jpg'), sourcePath);
await chmod(sourcePath, 0o444);
const originalHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
const formal = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const formalBefore = catalogSnapshot(formal);
const browser = await connectNative('http://127.0.0.1:9266', identifier);
const page = nativePage(browser);
const invoke = (command, args = {}) => invokeNative(page, command, args);
const db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
const checks = {};
let failure;
try {
  await page.goto('http://tauri.localhost/#/settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await invoke('catalog_reset', { seed: { version: 1, albums: [], media: [], models: [], tags: [], groups: [], recent: [], importRules: [], settings: { reducedMotion: true } } });
  const item = { id: 'release-boundary-photo', name: '写真-🌸-只读.jpg', kind: 'image', sourcePath,
    src: 'http://jingji.localhost/media/release-boundary-photo', size: (await stat(sourcePath)).size,
    width: 0, height: 0, favorite: false, liked: false, rating: 0, tags: [] };
  const album = { id: 'release-boundary-album', name: '中文长路径发行验收', subtitle: '', description: '', number: '',
    sourceDirectory: longDirectory, cover: item.src, coverMediaId: item.id, mediaIds: [item.id], modelIds: [], tags: [], favorite: false,
    createdAt: '2026-10-12', updatedAt: '2026-10-12' };
  const operation = { type: 'importPrepared', album, media: [item], models: [], tags: [], groups: [], importRules: [] };
  let before = catalogSnapshot(db);
  await expect(invoke('catalog_operation', { op: operation })).rejects.toThrow('媒体未经文件选择授权');
  expect(catalogSnapshot(db)).toBe(before);
  await expect(invoke('read_media_metadata', { id: item.id })).rejects.toBeTruthy();
  checks.unauthorizedImportAndMetadataRejectedWithoutChanges = true;

  // Simulate a successful picker grant for this exact disposable file only.
  db.prepare('INSERT OR IGNORE INTO authorized(path) VALUES(?)').run(sourcePath.replaceAll('\\', '/').toLowerCase());
  await invoke('catalog_operation', { op: operation });
  expect(sourcePath.length).toBeGreaterThan(260);
  const unexpectedWriter = await open(sourcePath, 'r+').catch(error => error);
  if (typeof unexpectedWriter.close === 'function') { await unexpectedWriter.close(); throw Error('Read-only fixture remains writable'); }
  expect(unexpectedWriter.code).toMatch(/EACCES|EPERM/);
  const metadata = await invoke('read_media_metadata', { id: item.id });
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  const thumbnail = await invoke('image_thumbnail', { source: `media:${item.id}`, edge: 512 });
  const decoded = await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, thumbnail);
  expect(Math.max(...decoded)).toBe(512);
  await page.goto(`http://tauri.localhost/#/viewer/${album.id}/${item.id}`);
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready');
  expect(await page.locator('.media-stage > img').evaluate(image => image.naturalWidth)).toBe(metadata.width);
  checks.unicodeLongPathThumbnailMetadataAndOriginalDecode = { pathCharacters: sourcePath.length, width: metadata.width, height: metadata.height };
  await page.goto('http://tauri.localhost/#/settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();

  before = catalogSnapshot(db);
  const fullAlbum = await invoke('catalog_entity', { kind: 'albums', id: album.id });
  await expect(invoke('catalog_operation', { op: { type: 'saveAlbum', album: { ...fullAlbum, name: '应回滚', mediaIds: [item.id, 'missing-reference'] } } })).rejects.toBeTruthy();
  expect(catalogSnapshot(db)).toBe(before);
  await expect(invoke('catalog_patch', { changes: { media: [{ id: item.id, rating: 6 }] } })).rejects.toBeTruthy();
  expect(catalogSnapshot(db)).toBe(before);
  checks.invalidReferencesAndRatingsRollback = true;

  // A SQLite abort exercises native write failure and retry without changing OS permissions.
  db.exec("CREATE TRIGGER release_write_failure BEFORE UPDATE ON entities WHEN NEW.id='release-boundary-photo' BEGIN SELECT RAISE(ABORT, 'release injected write abort'); END");
  try {
    await expect(invoke('catalog_patch', { changes: { media: [{ id: item.id, favorite: true }] } })).rejects.toBeTruthy();
    expect(catalogSnapshot(db)).toBe(before);
  } finally { db.exec('DROP TRIGGER IF EXISTS release_write_failure'); }
  await invoke('catalog_patch', { changes: { media: [{ id: item.id, favorite: true, rating: 4 }] } });
  await page.reload();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(await invoke('catalog_entity', { kind: 'media', id: item.id })).toMatchObject({ favorite: true, rating: 4 });
  checks.nativeWriteFailureRollbackRetryAndWebviewReload = true;

  await invoke('catalog_operation', { op: { type: 'removeAlbum', id: album.id } });
  expect(await invoke('catalog_entity', { kind: 'albums', id: album.id })).toBeNull();
  expect(await invoke('catalog_entity', { kind: 'media', id: item.id })).toBeTruthy();
  expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(originalHash);
  expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  checks.albumDeletionPreservesMediaAndDatabaseIntegrity = true;
} catch (error) { failure = error; }
finally {
  const originalMediaUnchanged = createHash('sha256').update(await readFile(sourcePath)).digest('hex') === originalHash;
  const formalCatalogUnchanged = catalogSnapshot(formal) === formalBefore;
  await chmod(sourcePath, 0o666);
  await mkdir(output, { recursive: true });
  const report = { engine: 'isolated Release Windows WebView2', identifier, checks, originalMediaUnchanged, formalCatalogUnchanged,
    failure: failure?.stack, limits: 'Exact picker authorization is inserted only for copied fixtures. SQLite abort is injected; physical full-disk/power-loss, UNC, removable-drive and native picker UI require environment acceptance.' };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  db.close(); formal.close(); await browser.close();
  expect(originalMediaUnchanged).toBe(true);
  expect(formalCatalogUnchanged).toBe(true);
}
if (failure) throw failure;
