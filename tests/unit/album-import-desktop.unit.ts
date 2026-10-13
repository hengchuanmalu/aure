import { expect,it,vi } from 'vitest';
import { prepareAlbumImport } from "../../src/application/album-import";
import type { FolderScan } from "../../src/domain/importing";
import { execute } from '../../src/infrastructure/desktop-repository';
import { seedFixture } from "../support/demo.fixture";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
it('desktop import resolves full context and submits only new entities in one native operation', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
  const context = seedFixture();
  // Native import context includes all names but only media paths selected for this import.
  context.albums = []; context.media = [];
  const folder: FolderScan = { path: 'D:/set', name: 'set', skipped: 0,
    manifest: { version: 1, name: '资料写真', number: '009', models: ['林夏', '新模特'], tags: ['清新', '新标签'], cover: '001.jpg', media: ['001.jpg'] },
    files: [{ path: 'D:/set/001.jpg', name: '001.jpg', kind: 'image', size: 10 }],
  };
  const pending = prepareAlbumImport(folder, context, { 'D:/set/001.jpg': 'asset://001.jpg' }, 'imported');
  // A matching entity arrives after the UI draft: it must be reused and keep its full data.
  context.models.push({ ...pending.models[1], id: 'concurrent', bio: '不可覆盖' });
  invoke.mockImplementation(async (command: string) => {
    if (command === 'catalog_import_context') return structuredClone(context);
    if (command === 'catalog_operation') return;
    throw Error(command);
  });
  await execute({ type: 'importAlbum', pending, album: pending.album });
  expect(invoke).toHaveBeenNthCalledWith(1, 'catalog_import_context', { paths: ['D:/set/001.jpg'], directory: 'D:/set' });
  const op = invoke.mock.calls[1][1].op;
  expect(op.type).toBe('importPrepared');
  expect(op.album.modelIds).toEqual(['m0', 'concurrent']);
  expect(op.models).toEqual([]);
  expect(op.tags.map((t: { name: string }) => t.name)).toEqual(['新标签']);
  expect(op.groups.map((g: { name: string }) => g.name)).toEqual(['导入标签']);
  expect(op.media).toHaveLength(1);
  expect(op.album.coverMediaId).toBe(op.media[0].id);
});
