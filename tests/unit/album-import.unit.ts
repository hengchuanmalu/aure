import { describe,expect,it } from 'vitest';
import { commitAlbumImport,prepareAlbumImport } from "../../src/application/album-import";
import type { FolderScan } from "../../src/domain/importing";
import { seedFixture } from "../support/demo.fixture";

const folder: FolderScan = {
  path: 'D:/sets/renamed', name: 'renamed', skipped: 0,
  manifest: { version: 1, name: 'JSON 写真', number: '009', models: ['林夏', '新模特'], tags: ['清新', '新标签'], cover: '002.jpg', media: ['002.jpg', '001.jpg'] },
  files: ['002.jpg', '001.jpg'].map(name => ({ path: 'D:/sets/renamed/' + name, name, kind: 'image', size: 10 })),
};
const sources = Object.fromEntries(folder.files.map(f => [f.path, 'asset://' + f.path]));
describe('manifest import transaction', () => {
  it('stages without mutating, preserves order and merges current media/models/tags at save', () => {
    const db = seedFixture();
    const before = structuredClone(db);
    const pending = prepareAlbumImport(folder, db, sources, 'new-album');
    expect(db).toEqual(before);
    expect(pending.album.modelIds[0]).toBe('m0');
    expect(pending.album.tags[0]).toBe('t00');
    // Concurrent imports must be resolved against the latest catalog, with references remapped.
    const existingMedia = { ...pending.media[0], id: 'existing-media' };
    const existingModel = { ...pending.models[1], id: 'existing-model', bio: '保留资料' };
    const existingTag = { ...pending.tags[1], id: 'existing-tag', groupId: db.groups[0].id };
    db.media.push(existingMedia); db.models.push(existingModel); db.tags.push(existingTag);
    commitAlbumImport(db, pending, { ...pending.album, name: '手动修改', tags: [pending.tags[1].id] });
    const saved = db.albums[0];
    expect(saved.name).toBe('手动修改');
    expect(saved.number).toBe('009');
    expect(saved.mediaIds).toEqual(['existing-media', pending.media[1].id]);
    expect(saved.coverMediaId).toBe('existing-media');
    expect(saved.modelIds).toEqual(['m0', 'existing-model']);
    expect(saved.tags).toEqual(['existing-tag']);
    expect(db.models.find(m => m.id === 'existing-model')?.bio).toBe('保留资料');
    expect(db.importRules).toEqual(before.importRules);
  });
  it('creates only selected staged associations and rejects duplicate imports without mutations', () => {
    const db = seedFixture();
    const pending = prepareAlbumImport(folder, db, sources, 'new');
    commitAlbumImport(db, pending, { ...pending.album, modelIds: ['m0'], tags: [pending.tags[1].id] });
    expect(db.models.some(m => m.name === '新模特')).toBe(false);
    expect(db.tags.find(t => t.name === '新标签')?.groupId).toBe(pending.groups[0].id);
    const saved = structuredClone(db);
    expect(() => commitAlbumImport(db, pending, pending.album)).toThrow('已导入');
    expect(db).toEqual(saved);
  });
  it('rejects ambiguous names and stale selections without partially creating data', () => {
    const db = seedFixture();
    const pending = prepareAlbumImport(folder, db, sources, 'new');
    db.models.push({ ...db.models[0], id: 'a', name: '新模特' }, { ...db.models[0], id: 'b', name: '新模特' });
    const before = structuredClone(db);
    expect(() => commitAlbumImport(db, pending, pending.album)).toThrow('同名');
    expect(db).toEqual(before);
    expect(() => commitAlbumImport(db, pending, { ...pending.album, modelIds: ['deleted'] })).toThrow('不存在');
    expect(db).toEqual(before);
  });
});
