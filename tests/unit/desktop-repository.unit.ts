import { expect,it } from 'vitest';
import { changes } from '../../src/infrastructure/desktop-repository';
import { largeLibrary } from "../support/large-library.fixture";

it('scoped media edits serialize only changed fields, without replacing unloaded library data', () => {
  const window = largeLibrary(1, 48);
  const draft = structuredClone(window);
  draft.media[17].rating = 4;
  draft.media[17].favorite = false;
  expect(changes(window, draft)).toEqual({ media: [{ id: 'media-17', rating: 4, favorite: false }] });
  expect(window.media[17].rating).toBe(0);
});
it('settings and new tags remain independent of media and album snapshots', () => {
  const window = largeLibrary(1, 48);
  const draft = structuredClone(window);
  draft.settings.reducedMotion = false;
  draft.tags.push({ id: 'new', name: '新标签', groupId: 'style' });
  expect(changes(window, draft)).toEqual({ tags: [{ id: 'new', name: '新标签', groupId: 'style' }], settings: { reducedMotion: false } });
});
