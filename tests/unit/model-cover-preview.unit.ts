import { afterEach, expect, it, vi } from 'vitest';
import { loadModelCoverPreview } from '../../src/infrastructure/model-cover-preview';
import { seedFixture } from '../support/demo.fixture';
import { readCandidates, readModelAlbums } from '../../src/infrastructure/desktop-repository';

vi.mock('../../src/infrastructure/desktop-repository', () => ({ readCandidates: vi.fn(), readModelAlbums: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('samples the complete native association while reading only the selected summaries', async () => {
  const db = seedFixture();
  db.albums = [];
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
  vi.mocked(readModelAlbums).mockResolvedValue(Array.from({ length: 120 }, (_, i) => `a${i}`));
  vi.mocked(readCandidates).mockImplementation(async (_kind, _page, query) => ({
    total: 3, items: (query?.ids as string[]).map(id => ({ id, cover: 'cover.jpg', modelIds: ['m0'] })),
  }));
  const albums = await loadModelCoverPreview('m0', db, true);
  expect(readModelAlbums).toHaveBeenCalledWith('m0');
  const query = vi.mocked(readCandidates).mock.calls[0][2]!;
  expect(query.model).toBe('m0');
  expect(query.ids).toHaveLength(3);
  expect(new Set(query.ids as string[]).size).toBe(3);
  expect((query.ids as string[])).toContain('a119');
  expect(albums.map(album => album.id)).toEqual(query.ids);
  expect(db.albums).toEqual([]);
});

it('empty native associations do not query the entire album library', async () => {
  vi.mocked(readModelAlbums).mockResolvedValue([]);
  expect(await loadModelCoverPreview('m0', seedFixture(), true)).toEqual([]);
  expect(readCandidates).not.toHaveBeenCalled();
});
