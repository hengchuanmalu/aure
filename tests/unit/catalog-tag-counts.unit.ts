import { describe, expect, it } from 'vitest';
import { catalog, queryAlbums } from '../../src/domain/catalog';
import { seedFixture } from '../support/demo.fixture';

describe('album tag counts include linked media', () => {
  it('counts each matching album once when the same tag is on several media and on the album', () => {
    const db = seedFixture();
    db.albums = db.albums.slice(0, 2).map(album => ({ ...album, tags: ['t00'], mediaIds: ['p0', 'p1'] }));
    db.media = db.media.slice(0, 2).map(item => ({ ...item, tags: ['t00', 't00'] }));
    expect(catalog(db).tagCounts.get('t00')).toBe(2);
    expect(queryAlbums(db, '', ['t00'])).toHaveLength(2);
  });

  it('agrees with filtering when the tag exists only on an album media item', () => {
    const db = seedFixture();
    db.albums = db.albums.slice(0, 2).map(album => ({ ...album, tags: [] }));
    db.media = db.media.map(item => ({ ...item, tags: item.id === 'p1' ? ['t00'] : [] }));
    expect(catalog(db).tagCounts.get('t00')).toBe(2);
    expect(queryAlbums(db, '', ['t00'])).toHaveLength(2);
  });

  it('uses the full native summary while the loaded media window omits the tagged item', () => {
    const db = seedFixture();
    db.albums = [{ ...db.albums[0], tags: [], mediaIds: [], _summary: {
      images: 500, videos: 0, bytes: 0, tags: ['t00', 't00'], searchText: '完整写真', previews: [],
    } }];
    db.media = [];
    expect(catalog(db).tagCounts.get('t00')).toBe(1);
    expect(queryAlbums(db, '', ['t00'])).toHaveLength(1);
  });
});
