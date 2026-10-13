// Refactor regression: all writes and resource grants use a disposable application/catalog.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { connectNative, nativePage, invokeNative, catalogSnapshot, isolatedIdentifier } from '../support/native-session.mjs';

const identifier = isolatedIdentifier('local.jingji.maintenance-test');
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9261', identifier);
const page = nativePage(browser);
page.setDefaultTimeout(15000);
const output = resolve('verification/maintenance-native');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (command, args) => invokeNative(page, command, args);
let db;
try {
  await mkdir(join(output, 'media'), { recursive: true });
  const names = ['flower.mp4', 'p-1239291.jpg', 'p-774909.jpg', 'p-733872.jpg'];
  const media = await Promise.all(names.map(async (name, index) => {
    const sourcePath = join(output, 'media', name);
    await copyFile(resolve('tests/fixtures/media', name), sourcePath);
    return { id: `maintenance-${index}`, name, kind: index ? 'image' : 'video', sourcePath,
      src: `http://jingji.localhost/media/maintenance-${index}`, size: (await stat(sourcePath)).size,
      width: 0, height: 0, tags: [], favorite: false, liked: false, rating: 0 };
  }));
  const hashes = () => Promise.all(media.map(async item => createHash('sha256').update(await readFile(item.sourcePath)).digest('hex')));
  const beforeHashes = await hashes();
  const seed = { version: 1, media: [], albums: [], models: [], tags: [], groups: [], recent: [], importRules: [], settings: { reducedMotion: true } };
  await invoke('catalog_reset', { seed });
  db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
  for (const item of media) db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(item.sourcePath.replaceAll('\\', '/').toLowerCase());
  const model = { id: 'maintenance-model', name: '维护测试模特', alias: '', bio: '', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] };
  const album = { id: 'maintenance-album', name: '维护测试写真', subtitle: '', description: '', number: '',
    cover: media[1].src, coverMediaId: media[1].id, mediaIds: media.map(item => item.id), modelIds: [model.id], tags: [],
    sourceDirectory: join(output, 'media'), favorite: false, createdAt: '2026-10-08', updatedAt: '2026-10-08' };
  await invoke('catalog_operation', { op: { type: 'importPrepared', album, media, models: [model], tags: [], groups: [], importRules: [] } });
  const expected = [media[1].id, media[2].id, media[3].id, media[0].id];
  const first = await invoke('catalog_view', { query: { route: 'album', id: album.id, limit: 2, page: 0 } });
  const last = await invoke('catalog_view', { query: { route: 'album', id: album.id, limit: 2, page: 1 } });
  expect([...first.visibleMediaIds, ...last.visibleMediaIds]).toEqual(expected);
  const imported = await invoke('catalog_entity', { kind: 'albums', id: album.id });
  const beforeFailure = catalogSnapshot(db);
  const invalid = { ...imported, id: 'maintenance-invalid', mediaIds: ['missing'] };
  await expect(invoke('catalog_operation', { op: { type: 'saveAlbum', album: invalid } })).rejects.toBeTruthy();
  expect(catalogSnapshot(db)).toBe(beforeFailure);

  await page.goto(`http://tauri.localhost/#/album/${album.id}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: album.name, exact: true })).toBeVisible();
  await expect.poll(() => db.prepare('SELECT album FROM recent WHERE album=?').get(album.id)?.album).toBe(album.id);
  const beforeCancel = catalogSnapshot(db);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await page.getByLabel('写真集名称', { exact: true }).fill('取消的草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
  expect(catalogSnapshot(db)).toBe(beforeCancel);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await page.getByLabel('写真集名称', { exact: true }).fill('整理后保存写真');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '整理后保存写真', exact: true })).toBeVisible();
  expect((await invoke('catalog_entity', { kind: 'albums', id: album.id })).mediaIds).toEqual(imported.mediaIds);
  await page.locator(`[data-media-id="${media[1].id}"]`).click();
  await expect(page.locator('.viewer .media-stage > img')).toBeVisible();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('.viewer .media-stage > img')).toHaveAttribute('style', /scale\(1.25\)/);
  await page.getByRole('button', { name: '返回详情', exact: true }).click();
  await expect(page.locator('.viewer')).toHaveCount(0);
  await page.locator(`.media-card[data-media-id="${media[0].id}"]`).click();
  const video = page.locator('.viewer video');
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '返回详情', exact: true }).click();
  await expect(page.locator('.viewer')).toHaveCount(0);
  await invoke('cancel_video', { requestId: randomUUID() });
  await page.goto(`http://tauri.localhost/#/models/${model.id}`);
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByLabel('模特名称', { exact: true }).fill('整理后保存模特');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '整理后保存模特', exact: true })).toBeVisible();
  expect(await invoke('catalog_model_albums', { id: model.id })).toEqual([album.id]);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '整理后保存模特', exact: true })).toBeVisible();
  expect(await hashes()).toEqual(beforeHashes);
  expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
  expect(errors).toEqual([]);
  const report = { identifier, engine: 'Windows WebView2', atomicImport: true, failedTransactionRolledBack: true,
    photosBeforeVideoAcrossWindows: true, cancelPreservesCatalog: true, fullEditorRelationsPreserved: true,
    imageZoom: true, videoLoadsAndExits: true, profileSaveAndReload: true, originalHashesUnchanged: true, errors };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { db?.close(); await browser.close(); }
