import { expect,it,vi } from 'vitest';
import { OriginalCoverCache } from "../../src/infrastructure/original-cover-cache";

const image = (width = 7008, height = 4672, complete = true) => ({ naturalWidth: width, naturalHeight: height, complete, remove: vi.fn() }) as unknown as HTMLImageElement;
it('reuses the hero across unmounts but releases replaced sources and file revisions', () => {
  const create = vi.fn(() => image());
  const cache = new OriginalCoverCache(create);
  const first = cache.take('media:one:revision-1');
  cache.release('media:one:revision-1', first);
  expect(cache.take('media:one:revision-1')).toBe(first);
  cache.release('media:one:revision-1', first);
  expect(cache.take('media:one:revision-2')).not.toBe(first);
  expect(create).toHaveBeenCalledTimes(2);
});
it('does not retain failed, pending or oversized decoded originals', () => {
  const create = vi.fn(() => image());
  const cache = new OriginalCoverCache(create);
  for (const candidate of [image(0, 0), image(7008, 4672, false), image(12000, 12000)]) {
    cache.release('hero', candidate);
    expect(cache.take('hero')).not.toBe(candidate);
    expect(candidate.remove).toHaveBeenCalledOnce();
  }
});
it('evicts old covers when either the total pixel budget or entry budget is exceeded', () => {
  const cache = new OriginalCoverCache(() => image(1000, 1000), 8 * 1024 * 1024, 2);
  const a = image(1000, 1000), b = image(1000, 1000), c = image(1000, 1000);
  cache.release('a', a); cache.release('b', b); cache.release('c', c);
  expect(cache.take('a')).not.toBe(a);
  expect(cache.take('b')).toBe(b);
  expect(cache.take('c')).toBe(c);
});
