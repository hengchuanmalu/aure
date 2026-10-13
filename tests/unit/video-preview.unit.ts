import { afterEach,expect,it,vi } from 'vitest';
import { claimPreview,releasePreview,stopPreviews } from "../../src/state/video-preview";

afterEach(stopPreviews);

it('switching cards stops the previous preview before giving the next card ownership', () => {
  const first = vi.fn(() => releasePreview(first));
  const next = vi.fn(() => releasePreview(next));
  claimPreview(first);
  claimPreview(next);
  expect(first).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  stopPreviews();
  stopPreviews();
  expect(next).toHaveBeenCalledTimes(1);
});

it('late cleanup of an old card does not release the active card', () => {
  const first = vi.fn(() => releasePreview(first));
  const next = vi.fn(() => releasePreview(next));
  claimPreview(first);
  claimPreview(next);
  releasePreview(first);
  stopPreviews();
  expect(next).toHaveBeenCalledTimes(1);
});
