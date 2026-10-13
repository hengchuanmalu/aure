import { expect,it } from 'vitest';
import { albumMedia } from "../../src/domain/catalog";
import { mediaLayout,type MediaLayoutMode } from "../../src/domain/media-layout";
import { seedFixture } from "../support/demo.fixture";

it('existing mixed albums keep each kind order, skip missing references and leave stored IDs intact', () => {
  const db = seedFixture();
  const ids = ['v1', 'p2', 'missing', 'v0', 'p0', 'p1'];
  db.albums[0].mediaIds = [...ids];
  expect(albumMedia(db.albums[0], db).map(item => item.id)).toEqual(['p2', 'p0', 'p1', 'v1', 'v0']);
  expect(db.albums[0].mediaIds).toEqual(ids);
});

for (const mode of ['masonry', 'tiles', 'adaptive'] as MediaLayoutMode[]) {
  it(`${mode} fills the last photo row with trailing videos`, () => {
    // Six photos followed by three videos, five items per row.
    const { boxes } = mediaLayout(Array(9).fill(1), 1000, { mode, columns: 5 });
    expect(boxes[6].y).toBeCloseTo(boxes[5].y);
    expect(boxes[6].x).toBeGreaterThan(boxes[5].x);
    expect(boxes[8].y).toBeCloseTo(boxes[5].y);
  });
}
