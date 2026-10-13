import { describe, expect, it } from 'vitest';
import cases from '../fixtures/search-cases.json';
import { seed } from '../../src/domain/database';
import { searchHighlights } from '../../src/domain/search';
import { suggestFromDatabase } from '../../src/infrastructure/search-service';
import type { Album, ModelProfile } from '../../src/domain/types';

function fixture() {
  const db = seed();
  db.groups = [{ id: 'group', name: '风格' }];
  db.tags = cases.tags;
  db.models = cases.models.map(model => ({ ...model, bio: '', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] } as ModelProfile));
  db.albums = cases.albums.map(album => ({ subtitle: '', description: '', number: '', cover: '', mediaIds: [], modelIds: [], tags: [], favorite: false, createdAt: '', updatedAt: '', ...album } as Album));
  return db;
}
describe('catalog suggestion ranking shared with Rust', () => {
  for (const example of cases.cases) it(JSON.stringify(example.query), () => {
    const db = fixture();
    const before = JSON.stringify(db);
    expect(suggestFromDatabase(db, example.query).map(item => item.id)).toEqual(example.ids);
    expect(JSON.stringify(db)).toBe(before);
  });
  it('searches beyond a page and balances a bounded result', () => {
    const db = fixture();
    const template = db.albums[0];
    db.albums = Array.from({ length: 150 }, (_, i) => ({ ...template, id: `extra-${i}`, name: `林夏写真 ${i}` }));
    expect(suggestFromDatabase(db, '林夏')).toHaveLength(8);
    expect(suggestFromDatabase(db, '林夏').some(item => item.kind === 'model')).toBe(true);
    expect(suggestFromDatabase(db, '林夏').some(item => item.kind === 'tag')).toBe(true);
    expect(suggestFromDatabase(db, '149')[0].id).toBe('extra-149');
  });
  it('maps normalization and supplementary characters back to original display offsets', () => {
    expect(searchHighlights('🌸ＳｅＹａ写真', 'seya')).toEqual([[2, 6]]);
    expect(searchHighlights('林间的夏天', '林夏')).toEqual([[0, 1], [3, 4]]);
    expect(searchHighlights('林夏写真', '林 夏')).toEqual([[0, 2]]);
  });
});
