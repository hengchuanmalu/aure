import { expect,test } from 'vitest';
import { backgroundResolution } from "../../src/domain/background-resolution";

test('cover resolution accounts for density, portrait cropping, zoom and bounded tiers', () => {
  expect(backgroundResolution(600, 338, 1, 1, 16 / 9)).toBe(1024);
  expect(backgroundResolution(600, 338, 2, 1, 16 / 9)).toBe(2048);
  expect(backgroundResolution(600, 338, 2, 1, 2 / 3)).toBe(2048);
  expect(backgroundResolution(600, 338, 2, 2, 2 / 3)).toBe(3072);
  expect(backgroundResolution(1200, 675, 3, 3, 1 / 4)).toBe(3072);
});
