import { connectNative, nativePage } from '../support/native-session.mjs';
// Native writes are restricted to the isolated avatar-test identifier.
import { expect } from '@playwright/test';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const browser = await connectNative('http://127.0.0.1:9241', "local.jingji.avatar-test");
try {
  const page = nativePage(browser);
  if (!page) throw Error('Isolated WebView missing');
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.avatar-test');
  const root = resolve('verification/avatar-native/files');
  await mkdir(root, { recursive: true });
  const media = [];
  for (let i = 0; i < 8; i++) {
    const path = join(root, `photo-${i}.jpg`);
    await copyFile(resolve(`tests/fixtures/media/${i % 2 ? 'p-774909' : 'p-1239291'}.jpg`), path);
    media.push({ id: `avatar-photo-${i}`, sourcePath: path, src: `http://jingji.localhost/media/avatar-photo-${i}`, kind: 'image', name: `photo-${i}.jpg`,
      width: 1600, height: 2400, size: (await stat(path)).size, tags: [], favorite: i < 2, liked: false, rating: 0 });
  }
  const hashes = await Promise.all(media.map(async item => createHash('sha256').update(await readFile(item.sourcePath)).digest('hex')));
  const candidatesMedia = [];
  for (let i = 0; i < 327; i++) {
    const id = `native-photo-${String(i).padStart(3, '0')}`;
    const sourcePath = join(root, `${id}.jpg`);
    await copyFile(media[i % 8].sourcePath, sourcePath);
    candidatesMedia.push({ ...media[i % 8], id, sourcePath, src: `http://jingji.localhost/media/${id}`, favorite: true });
  }
  const model = { id: 'avatar-model', name: '头像验收', alias: '', bio: '', avatar: media[0].src, background: media[2].src, avatarFocus: 35, backgroundFocus: 35, fields: [], links: [], photoIds: [] };
  const albums = Array.from({ length: 55 }, (_, i) => ({ id: `avatar-album-${i}`, name: `验收写真 ${String(i).padStart(2, '0')}`, subtitle: '', description: '', cover: media[0].src,
    mediaIds: media.slice(i % 2 ? 0 : 4, i % 2 ? 4 : 8).map(item => item.id), modelIds: [model.id], tags: [], favorite: false, createdAt: '2026-10-06', updatedAt: '2026-10-06' }));
  await invoke('catalog_reset', { seed: { version: 1, media: [...media, ...candidatesMedia], models: [model], albums, tags: [], groups: [], recent: [], settings: { reducedMotion: false } } });
  const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.avatar-test', 'catalog.sqlite3'));
  for (const item of media) db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(item.sourcePath.replaceAll('\\', '/').toLowerCase());
  db.close();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://tauri.localhost/#/models/avatar-model');
  await page.reload();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await expect(page.getByRole('button', { name: '全部图片', exact: true })).toHaveCount(0);
  await expect(page.locator('.picker-pages')).toHaveCount(0);
  const scroll = page.getByRole('group', { name: '头像照片', exact: true });
  await expect(page.getByRole('button', { name: '头像 素材 1', exact: true })).toBeVisible();
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('button', { name: '头像 素材 329', exact: true })).toBeVisible();
  expect(await page.locator('.avatar-photo-grid button').count()).toBeLessThan(40);
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: '头像 素材 1', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.avatar-crop-stage img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: '下一组写真集' }).click();
  await expect(page.getByRole('group', { name: '头像图片来源' }).getByRole('button')).toHaveCount(8);
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '验收写真 52', exact: true }).click();
  await expect(page.locator('.avatar-photo-grid button')).toHaveCount(4);
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '头像 素材 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '头像 素材 2', exact: true }).click();
  await page.getByLabel('头像缩放').fill('165');
  const stage = page.getByRole('group', { name: '头像裁切区域' });
  await stage.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.getByLabel('头像缩放').inputValue()).toBe('182');
  await page.getByLabel('头像缩放').fill('165');
  await stage.press('ArrowUp');
  await stage.press('ArrowLeft');
  const previewStyle = await stage.locator('img').getAttribute('style');
  await page.screenshot({ path: 'verification/avatar-native/editor.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const persisted = await invoke('catalog_entity', { kind: 'models', id: model.id });
  expect(persisted.avatarCrop).toEqual({ x: 48, y: 48, zoom: 1.65 });
  expect(decodeURIComponent(persisted.avatar)).toBe(media[1].src);
  expect(decodeURIComponent(persisted.background)).toBe(model.background);
  expect(persisted.photoIds).toEqual([]);
  const relationships = await invoke('catalog_model_albums', { id: model.id });
  expect(relationships).toHaveLength(55);
  await page.reload();
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('style', previewStyle);
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await page.getByLabel('头像缩放').fill('220');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  expect((await invoke('catalog_entity', { kind: 'models', id: model.id })).avatarCrop).toEqual(persisted.avatarCrop);
  for (let i = 0; i < media.length; i++) expect(createHash('sha256').update(await readFile(media[i].sourcePath)).digest('hex')).toBe(hashes[i]);
  expect(errors).toEqual([]);
  await writeFile('verification/avatar-native/results.json', JSON.stringify({ engine: 'Windows WebView2', identifier: 'local.jingji.avatar-test', sources: true,
    albumPagination: true, scrollThrough329: true, boundedDOM: true, wheelZoom: true, savedCrop: persisted.avatarCrop, reload: true, cancel: true, associationsPreserved: 55, backgroundPreserved: true, originalHashesUnchanged: true, errors }, null, 2));
  console.log('Native avatar sources, crop save/reload, cancel and 55 associations passed; originals unchanged.');
  // Leave an unsaved editor for the Windows file picker check.
  await copyFile(media[3].sourcePath, join(root, 'local-avatar.jpg'));
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
} finally { await browser.close(); }
