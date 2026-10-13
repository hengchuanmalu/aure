import type { Database } from '../../src/domain/types';

/** Metadata-only fixture: real file decoding/IO must be measured separately. */
export function largeLibrary(albumCount = 1000, mediaCount = 100000): Database {
  const db: Database = { version: 1, albums: [], media: [], models: [], tags: [{ id: 'portrait', name: '人像', groupId: 'style' }], groups: [{ id: 'style', name: '风格' }], recent: [], settings: { reducedMotion: true } };
  for (let i = 0; i < 20; i++) db.models.push({ id: `model-${i}`, name: `模特 ${i}`, alias: '', bio: '', avatar: '/tests/fixtures/media/p-1239291.jpg', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] });
  for (let i = 0; i < mediaCount; i++) db.media.push({ id: `media-${i}`, kind: 'image', name: `照片 ${i}.jpg`, src: '/tests/fixtures/media/p-1239291.jpg', size: 20 * 1024 * 1024, width: 6000, height: 4000, tags: i % 7 ? [] : ['portrait'], favorite: true, liked: false, rating: 0 });
  for (let i = 0; i < albumCount; i++) {
    const start = Math.floor(i * mediaCount / albumCount), end = Math.floor((i + 1) * mediaCount / albumCount);
    db.albums.push({ id: `album-${i}`, name: `写真 ${String(i).padStart(5, '0')}`, subtitle: '', description: '', number: `${i}`, cover: '/tests/fixtures/media/p-1239291.jpg', mediaIds: db.media.slice(start, end).map(m => m.id), tags: [], modelIds: [`model-${i % 20}`], favorite: true, createdAt: '2026-09-29', updatedAt: '2026-09-29' });
  }
  return db;
}
