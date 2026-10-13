import { expect,it,vi } from 'vitest';
import { commitAlbumImport } from "../../src/application/album-import";
import { batchModelGroups,importBatchEntries,prepareBatchImport,type FolderBatchScan } from "../../src/application/batch-album-import";
import { seedFixture } from "../support/demo.fixture";

const scan: FolderBatchScan = { path: 'D:/root', name: '写真', issues: [], albums: ['A', 'B', 'C'].map((name, index) => ({
  path: `D:/root/${name}`, name, skipped: 0,
  manifest: { version: 1, name: `写真 ${name}`, number: String(index), models: index === 2 ? ['新人物', '林夏'] : ['新人物'], tags: ['新标签'], cover: 'cover.jpg', media: [] },
  files: [{ name: 'clip.mp4', path: `D:/root/${name}/clip.mp4`, kind: 'video', size: 30 }, { name: 'cover.jpg', path: `D:/root/${name}/cover.jpg`, kind: 'image', size: 20 }],
})) };
const sources = Object.fromEntries(scan.albums.flatMap(a => a.files.map(f => [f.path, 'asset://' + f.path])));
it('shares staged models and tags, counts multi-model sets, and preserves input until committing', () => {
  const db = seedFixture(), before = structuredClone(db);
  const batch = prepareBatchImport(scan, db, sources);
  expect(db).toEqual(before);
  expect(batch.entries.map(e => e.album!.modelIds[0])).toEqual(Array(3).fill(batch.entries[0].album!.modelIds[0]));
  expect(batchModelGroups(batch.entries).map(g => [g.model?.name, g.entries.length])).toEqual([['新人物', 3], ['林夏', 1]]);
  for (const entry of batch.entries) commitAlbumImport(db, entry.pending!, entry.album!);
  expect(db.models.filter(m => m.name === '新人物')).toHaveLength(1);
  expect(db.tags.filter(t => t.name === '新标签')).toHaveLength(1);
  for (const entry of batch.entries) expect(db.albums.find(a => a.id === entry.album!.id)!.mediaIds.map(id => db.media.find(m => m.id === id)!.kind)).toEqual(['image', 'video']);
  const repeated = prepareBatchImport(scan, db, sources);
  expect(repeated.entries.map(e => e.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
  expect(batchModelGroups(repeated.entries)[0].entries).toHaveLength(3);
});
it('continues after a failed album and retries only unsaved items', async () => {
  const entries = prepareBatchImport(scan, seedFixture(), sources).entries;
  const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('磁盘繁忙')).mockResolvedValueOnce(undefined);
  const result = (entry: typeof entries[number], patch: Partial<typeof entry>) => Object.assign(entry, patch);
  await importBatchEntries(entries, save, result);
  expect(entries.map(e => e.status)).toEqual(['imported', 'error', 'imported']);
  const retry = vi.fn().mockResolvedValue(undefined);
  await importBatchEntries(entries, retry, result);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry.mock.calls[0][1].name).toBe('写真 B');
  expect(entries.every(e => e.status === 'imported')).toBe(true);
});
