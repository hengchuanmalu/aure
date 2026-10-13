import { expect, it } from 'vitest';
import { applyOperation } from '../../src/application/operations';
import { seedFixture } from '../support/demo.fixture';

it('moving a deleted group preserves every tag ID and album/media association, including deleting ungrouped itself', () => {
  const db=seedFixture();
  const tags=structuredClone(db.tags.filter(t=>t.groupId==='g0'));
  const relationships=JSON.stringify([db.albums.map(a=>a.tags),db.media.map(m=>m.tags)]);
  applyOperation(db,{type:'removeTag',id:'g0',group:true});
  const group=db.groups.find(g=>g.name==='未分组')!;
  expect(db.tags.filter(t=>t.groupId===group.id).map(t=>t.id)).toEqual(tags.map(t=>t.id));
  expect(JSON.stringify([db.albums.map(a=>a.tags),db.media.map(m=>m.tags)])).toBe(relationships);
  applyOperation(db,{type:'removeTag',id:group.id,group:true});
  expect(db.tags.filter(t=>tags.some(old=>old.id===t.id))).toHaveLength(tags.length);
  expect(db.tags.every(t=>db.groups.some(g=>g.id===t.groupId))).toBe(true);
});

it('batch tags target selected albums and optionally their full referenced media, preserving existing tags',()=>{
  const db=seedFixture();
  const album=db.albums[0];const otherBefore=structuredClone(db.albums[1]);
  const previous=structuredClone(db.media);
  applyOperation(db,{type:'addAlbumTags',albumIds:[album.id],tagIds:['t03'],includeMedia:false});
  expect(album.tags).toContain('t03');expect(db.media).toEqual(previous);expect(db.albums[1]).toEqual(otherBefore);
  applyOperation(db,{type:'addAlbumTags',albumIds:[album.id],tagIds:['t03'],includeMedia:true});
  for(const id of album.mediaIds)expect(db.media.find(m=>m.id===id)?.tags).toContain('t03');
  expect(album.tags.filter(id=>id==='t03')).toHaveLength(1);
});
