import { connectNative, nativePage } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const browser = await connectNative('http://127.0.0.1:9246', "local.jingji.sidebar-tags-test");
try {
  const page = nativePage(browser);
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.sidebar-tags-test');
  await invoke('catalog_reset', { seed: { version: 1, albums: [], media: [], models: [], groups: [], tags: [],
    settings: { reducedMotion: true }, recent: [], importRules: [] } });
  await page.goto('http://tauri.localhost/#/tags');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByRole('combobox', { name: '标签名称', exact: true }).fill('第一个标签');
  await page.getByRole('combobox', { name: '标签名称', exact: true }).press('Escape');
  await expect(page).toHaveURL(/#\/tags$/);
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索或创建分类', exact: true }).fill('新建分类');
  await page.getByRole('button', { name: '创建「新建分类」', exact: true }).click();
  const beforeCreate = await invoke('catalog_view', { query: { route: 'tags' } });
  expect(beforeCreate.db.groups).toHaveLength(0);
  await page.screenshot({ path: 'verification/tag-dialog-native.png' });
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const created = await invoke('catalog_view', { query: { route: 'tags' } });
  expect(created.db.tags).toHaveLength(1);
  expect(created.db.groups).toHaveLength(1);
  expect(created.db.tags[0].groupId).toBe(created.db.groups[0].id);
  expect(created.db.groups[0].name).toBe('新建分类');
  console.log('Isolated WebView2: tag and new category saved atomically from the current page.');
  const root = resolve('verification/sidebar-tags-isolated/files');
  await mkdir(root, { recursive: true });
  const media = [];
  for (const [i, fixture] of ['p-1239291', 'p-774909', 'p-733872', 'p-1382731'].entries()) {
    const source = join(root, `disposable-${i}.jpg`);
    await copyFile(resolve(`tests/fixtures/media/${fixture}.jpg`), source);
    media.push({ id: `p${i}`, sourcePath: source, src: `http://jingji.localhost/media/p${i}`, name: `disposable-${i}.jpg`, kind: 'image', width: 1600, height: 2400,
      size: (await stat(source)).size, tags: ['one'], favorite: false, liked: false, rating: 0 });
  }
  const model = { id: 'm', name: '林夏', alias: '', bio: '', avatar: media[0].src, background: '', fields: [], links: [], photoIds: [] };
  const albums = Array.from({ length: 130 }, (_, i) => ({ id: `tag-album-${i}`, name: `验证写真 ${String(i).padStart(3, '0')}`,
    number: '', subtitle: '', description: '', cover: media[i % 4].src, mediaIds: [0, 1, 2].map(offset => media[(i + offset) % 4].id), modelIds: i % 4 ? [] : [model.id], tags: i % 2 ? [] : ['two'],
    favorite: false, createdAt: '2026-10-06', updatedAt: '2026-10-06' }));
  await invoke('catalog_reset', { seed: { version: 1, albums, media, models: [model], groups: [{ id: 'g', name: '验证' }],
    tags: [{ id: 'one', name: '清新', groupId: 'g' }, { id: 'two', name: '城市', groupId: 'g' }, { id: 'unused', name: '未使用', groupId: 'g' }],
    settings: { reducedMotion: true, videoHoverPreview: false }, recent: [], importRules: [] } });
  const disposableDb = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.sidebar-tags-test', 'catalog.sqlite3'));
  try { for (const item of media) disposableDb.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(item.sourcePath.replaceAll('\\', '/').toLowerCase()); }
  finally { disposableDb.close(); }
  await page.reload();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
} finally { await browser.close(); }
process.env.AURE_TAGS_ISOLATED = '1';
process.env.AURE_CDP_URL = 'http://127.0.0.1:9246';
await import("./native-sidebar-tags.mjs");
