import { describe,expect,it,vi } from 'vitest';
import { albumMedia,catalog,queryAlbums } from "../../src/domain/catalog";
import { ThumbnailQueue } from '../../src/infrastructure/thumbnail-service';
import { largeLibrary } from "../support/large-library.fixture";

describe('large library query budget', () => {
  for (const [albums, media] of [[1000, 100000], [5000, 300000]]) it(`${albums} albums / ${media} media`, () => {
    const db = largeLibrary(albums, media);
    const start = performance.now();
    const index = catalog(db);
    const cold = performance.now() - start;
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const result = queryAlbums(db, '人像', ['portrait'], `model-${i % 20}`, 'image');
      samples.push(performance.now() - start);
      expect(result).toHaveLength(albums / 20);
    }
    expect(catalog({ ...db, recent: [] })).toBe(index);
    expect(albumMedia(db.albums.at(-1)!, db)).toHaveLength(media / albums);
    expect(index.summaries.get(db.albums[0].id)?.bytes).toBe(media / albums * 20 * 1024 * 1024);
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ albums, media, indexMs: cold, searchP50Ms: samples[15], searchP95Ms: samples[28], jsonMiB: JSON.stringify(db).length / 1024 / 1024 }));
    // Generous regression ceilings, not desktop product acceptance claims.
    expect(cold).toBeLessThan(5000);
    expect(samples[28]).toBeLessThan(500);
  });
  it('rebuilds changed tags/media but reuses indexes for recent-only updates', () => {
    const db = largeLibrary(1, 10);
    const before = catalog(db);
    const updated = { ...db, media: db.media.map(m => ({ ...m, tags: [] })) };
    expect(queryAlbums(updated, '人像')).toHaveLength(0);
    expect(catalog(updated)).not.toBe(before);
    const renamed = { ...db, tags: [{ ...db.tags[0], name: '改名' }] };
    expect(queryAlbums(renamed, '改名')).toHaveLength(1);
    expect(queryAlbums(renamed, '人像')).toHaveLength(0);
  });
  it('compares the old nested scan on a bounded baseline', () => {
    const db = largeLibrary(100, 10000);
    const oldStart = performance.now();
    const old = db.albums.filter(a => db.media.filter(m => a.mediaIds.includes(m.id)).some(m => m.tags.includes('portrait')));
    const oldMs = performance.now() - oldStart;
    const newStart = performance.now();
    const result = queryAlbums(db, '', ['portrait']);
    console.log(JSON.stringify({ baseline: '100 albums / 10000 media', oldNestedScanMs: oldMs, indexedIncludingBuildMs: performance.now() - newStart }));
    expect(result.map(a => a.id)).toEqual(old.map(a => a.id));
  });
});

describe('thumbnail work ownership', () => {
  it('coalesces only matching source and resolution while keeping a shared queue', async () => {
    const generate = vi.fn(async (source: string, edge: number) => `${source}:${edge}`);
    const queue = new ThumbnailQueue(generate);
    const small = queue.request('same'), large = queue.request('same', 0, 2048), duplicate = queue.request('same', 0, 2048);
    expect(await Promise.all([small.promise, large.promise, duplicate.promise])).toEqual(['same:512', 'same:2048', 'same:2048']);
    expect(generate.mock.calls).toEqual([['same', 512], ['same', 2048]]);
  });
  it('visible covers precede queued decorative previews', async () => {
    const resolvers = new Map<string, (url: string) => void>();
    const generate = vi.fn((source: string) => new Promise<string>(resolve => resolvers.set(source, resolve)));
    const queue = new ThumbnailQueue(generate, 1);
    const active = queue.request('active');
    const leaf = queue.request('leaf', -1);
    const cover = queue.request('cover', 1);
    await Promise.resolve(); resolvers.get('active')!('active.jpg'); await active.promise;
    await vi.waitFor(() => expect(generate.mock.calls.map(c => c[0])).toEqual(['active', 'cover']));
    resolvers.get('cover')!('cover.jpg'); await cover.promise;
    await vi.waitFor(() => expect(resolvers.has('leaf')).toBe(true));
    resolvers.get('leaf')!('leaf.jpg'); await leaf.promise;
  });
  it('bounds concurrency, coalesces duplicates and cancels stale pending work', async () => {
    const resolvers = new Map<string, (v: string) => void>();
    const generate = vi.fn((source: string) => new Promise<string>(resolve => resolvers.set(source, resolve)));
    const queue = new ThumbnailQueue(generate);
    const a = queue.request('a'), duplicate = queue.request('a'), b = queue.request('b'), stale = queue.request('stale'), c = queue.request('c');
    const cancelled = expect(stale.promise).rejects.toMatchObject({ name: 'AbortError' });
    stale.cancel();
    await Promise.resolve();
    expect(generate.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    resolvers.get('a')!('a.jpg');
    await expect(a.promise).resolves.toBe('a.jpg');
    await expect(duplicate.promise).resolves.toBe('a.jpg');
    expect(generate.mock.calls.map(c => c[0])).toEqual(['a', 'b', 'c']);
    resolvers.get('b')!('b.jpg'); resolvers.get('c')!('c.jpg');
    await Promise.all([b.promise, c.promise, cancelled]);
  });
  it('failed work frees a slot and permits retry', async () => {
    const generate = vi.fn().mockRejectedValueOnce(Error('decode failed')).mockResolvedValue('ok');
    const queue = new ThumbnailQueue(generate, 1);
    await expect(queue.request('bad').promise).rejects.toThrow('decode failed');
    await expect(queue.request('bad').promise).resolves.toBe('ok');
  });
});
