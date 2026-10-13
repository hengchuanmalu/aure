import { connectNative, nativePage } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const browser = await connectNative('http://127.0.0.1:9252', 'local.jingji.automatic-import-test');
const page = nativePage(browser);
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const output = resolve('verification/automatic-import-native');
const root = join(output, '写真');
const directories = [join(root, '林夏', '林夏 NO.009 清新 [99P-1GB]'), join(root, '来自百度网盘', 'NO.10418'), join(root, '江月', '原始目录名')];
const originals = directories.flatMap((directory, index) => index ? [join(directory, 'cover.jpg')] : ['2.jpg', '10.jpg', 'cover.jpg', '1.mp4'].map(name => join(directory, name)));
const snapshotFiles = [...originals, join(directories[2], 'album.json')];
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
try {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.automatic-import-test');
  if (process.argv[2] === 'prepare') {
    await mkdir(output, { recursive: true });
    for (const path of originals) {
      await mkdir(resolve(path, '..'), { recursive: true });
      await copyFile(resolve(path.endsWith('mp4') ? 'tests/fixtures/media/flower.mp4' : 'tests/fixtures/media/p-1239291.jpg'), path);
    }
    await writeFile(join(directories[2], 'album.json'), JSON.stringify({ version: 1, name: 'JSON 资料优先', number: '003', models: ['江月'], tags: ['清新'], cover: 'cover.jpg' }));
    await writeFile(join(output, 'original-hashes.json'), JSON.stringify(await Promise.all(snapshotFiles.map(hash))));
    await invoke('catalog_reset', { seed: { version: 1, albums: [], media: [],
      models: [{ id: 'known-model', name: '林夏', alias: 'Linxia', bio: '已有资料不可覆盖', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] }],
      groups: [{ id: 'known-group', name: '风格' }], tags: [{ id: 'known-tag', name: '清新', groupId: 'known-group' }], recent: [], settings: { reducedMotion: true }, importRules: [] } });
    await page.goto('http://tauri.localhost/#/library?create=1');
    await page.getByRole('button', { name: '从文件夹导入', exact: true }).click();
    console.log(`Choose disposable directory: ${root}`);
  } else if (process.argv[2] === 'result') {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const result = await invoke('catalog_view', { query: { route: 'library', limit: 96 } });
    expect(result.albumTotal).toBe(3);
    expect(result.modelTotal).toBe(2);
    const raw = result.db.albums.find(a => a.number === '009');
    expect(raw.name).toBe('清新');
    const full = await invoke('catalog_entity', { kind: 'albums', id: raw.id });
    const media = await invoke('catalog_candidates', { kind: 'media', page: 0, query: { album: raw.id } });
    expect(media.items.map(m => m.name)).toEqual(['2.jpg', '10.jpg', 'cover.jpg', '1.mp4']);
    expect(media.items.filter(m => m.kind === 'image')).toHaveLength(3);
    expect(media.items.filter(m => m.kind === 'video')).toHaveLength(1);
    expect(full.modelIds).toEqual(['known-model']);
    expect(full.importMetadata.ruleVersion).toBe('local-text-v1');
    expect((await invoke('catalog_entity', { kind: 'models', id: 'known-model' })).bio).toBe('已有资料不可覆盖');
    const unknown = await invoke('catalog_entity', { kind: 'albums', id: result.db.albums.find(a => a.number === '10418').id });
    expect(unknown.modelIds).toEqual([]); expect(unknown.name).toBe('NO.10418');
    expect(result.db.albums.some(a => a.name === 'JSON 资料优先')).toBe(true);
    await page.screenshot({ path: join(output, 'imported.png') });
    await page.goto(`http://tauri.localhost/#/album/${raw.id}?edit=1`);
    await page.getByLabel('写真集名称', { exact: true }).fill('桌面手动修改');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('桌面手动修改');
    expect((await invoke('catalog_entity', { kind: 'albums', id: raw.id })).importMetadata.fields.name.source).toBe('manual');
    await page.goto('http://tauri.localhost/#/library?create=1');
    await page.getByRole('button', { name: '从文件夹导入', exact: true }).click();
    console.log(`Reselect same disposable directory: ${root}`);
  } else {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const result = await invoke('catalog_view', { query: { route: 'library', limit: 96 } });
    expect(result.albumTotal).toBe(3); expect(result.modelTotal).toBe(2);
    expect(result.db.albums.find(a => a.number === '009').name).toBe('桌面手动修改');
    expect(await Promise.all(snapshotFiles.map(hash))).toEqual(JSON.parse(await readFile(join(output, 'original-hashes.json'), 'utf8')));
    for (const directory of directories.slice(0, 2)) {
      let missing = false; try { await readFile(join(directory, 'album.json')); } catch (e) { missing = e.code === 'ENOENT'; }
      expect(missing).toBe(true);
    }
    const report = { engine: 'isolated Windows WebView2', automaticImport: true, albums: 3, models: 2, duplicateSkipped: true, manualEditPreserved: true, originalMediaUnchanged: true, generatedJson: false };
    await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
} finally { await browser.close(); }
