import type { Album, Database } from '@/domain/types';
import { readCandidates, readModelAlbums } from '@/infrastructure/desktop-repository';

function sample<T>(items: readonly T[], limit = 3): T[] {
  const pool = [...items];
  for (let i = 0; i < Math.min(limit, pool.length); i++) {
    const index = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[index]] = [pool[index], pool[i]];
  }
  return pool.slice(0, limit);
}

export async function loadModelCoverPreview(modelId: string, db: Database, remote: boolean): Promise<Album[]> {
  if (!remote) return sample(db.albums.filter(album => album.modelIds.includes(modelId) && album.cover));
  // Sample lightweight IDs from the complete relation, then load only three summaries.
  // The page snapshot may contain none of this person's albums.
  const ids = sample(await readModelAlbums(modelId));
  if (!ids.length) return [];
  const result = await readCandidates<Album>('albums', 0, { model: modelId, ids });
  const byId = new Map(result.items.map(album => [album.id, album]));
  return ids.flatMap(id => {
    const album = byId.get(id);
    return album?.cover ? [album] : [];
  });
}
