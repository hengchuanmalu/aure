import { expect,it } from 'vitest';
import { backgroundCrop,backgroundImageStyle } from "../../src/domain/background-crop";

it('old background focus remains usable without a migration', () => {
  expect(backgroundCrop({ backgroundFocus: 35 })).toEqual({ x: 50, y: 35, zoom: 1 });
});
it('crop bounds and invalid historical values are safe', () => {
  expect(backgroundCrop({ backgroundFocus: NaN, backgroundCrop: { x: Infinity, y: -10, zoom: 100 } })).toEqual({ x: 50, y: 0, zoom: 3 });
  expect(backgroundImageStyle({ x: 25, y: 70, zoom: 1.5 })).toEqual({ objectPosition: '25% 70%', transformOrigin: '25% 70%', transform: 'scale(1.5)' });
});
