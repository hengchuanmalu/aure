import { describe,expect,it } from "vitest";
import {
mediaLayout,
mediaViewportIndex,
parseMediaView,
type MediaLayoutMode,
} from "../../src/domain/media-layout";

describe("media display geometry", () => {
  it('viewport index matches a full scan for all layouts, boundaries and extreme aspect ratios', () => {
    for (const mode of ['masonry', 'tiles', 'adaptive'] as MediaLayoutMode[]) {
      const { boxes, height } = mediaLayout(Array.from({ length: 1000 }, (_, index) => index % 97 === 0 ? 0.001 : 0.4 + index % 17), 1300, { mode, columns: 7 });
      const indexed = mediaViewportIndex(boxes);
      for (const start of [-1000, 0, 100, 5000, height / 2, height, height + 1]) {
        const end = start + 900;
        expect(indexed.visible(start, end)).toEqual(boxes.flatMap((box, index) => box.y <= end && box.y + box.height >= start ? [index] : []));
      }
    }
    expect(mediaViewportIndex([]).visible(0, 100)).toEqual([]);
    expect(mediaViewportIndex([{ x: 0, y: 10, width: 1, height: 10 }]).visible(20, 10)).toEqual([]);
  });

  it('100k media: indexed viewport selection avoids a full scan on every scroll', () => {
    const { boxes, height } = mediaLayout(Array.from({ length: 100000 }, (_, i) => 0.5 + i % 5), 1400, { mode: 'masonry', columns: 5 });
    const indexed = mediaViewportIndex(boxes);
    const windows = Array.from({ length: 100 }, (_, i) => height * i / 100);
    const start = performance.now();
    const expected = windows.map(top => boxes.flatMap((box, index) => box.y <= top + 1800 && box.y + box.height >= top ? [index] : []));
    const scanMs = performance.now() - start;
    const indexStart = performance.now();
    const actual = windows.map(top => indexed.visible(top, top + 1800));
    const indexedMs = performance.now() - indexStart;
    expect(actual).toEqual(expected);
    console.log(JSON.stringify({ media: boxes.length, viewportQueries: windows.length, scanMs, indexedMs }));
    expect(indexedMs).toBeLessThan(1000);
  });
  const ratios = [2 / 3, 1.8, 1, 0.5, 3, 0, NaN, 0.7, 1.4, 0.8, 2];
  for (const mode of ["masonry", "tiles", "adaptive"] as MediaLayoutMode[]) {
    it(`${mode}: mixed and unknown sizes stay finite, inside the page and do not overlap`, () => {
      for (const width of [48, 720, 1450]) {
        const result = mediaLayout(ratios, width, { mode, columns: 4 });
        expect(result.boxes).toHaveLength(ratios.length);
        for (const box of result.boxes) {
          expect(
            [box.x, box.y, box.width, box.height].every(Number.isFinite),
          ).toBe(true);
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1e-8);
          expect(box.y + box.height).toBeLessThanOrEqual(result.height + 1e-8);
        }
        result.boxes.forEach((box, i) =>
          result.boxes.slice(i + 1).forEach((other) => {
            const overlap =
              Math.min(box.x + box.width, other.x + other.width) -
                Math.max(box.x, other.x) >
                1e-8 &&
              Math.min(box.y + box.height, other.y + other.height) -
                Math.max(box.y, other.y) >
                1e-8;
            expect(overlap).toBe(false);
          }),
        );
      }
    });
  }
  it("adaptive rows preserve original proportions and fill complete rows exactly", () => {
    const { boxes } = mediaLayout([0.5, 2, 1, 2, 0.5, 1, 1], 1000, {
      mode: "adaptive",
      columns: 3,
    });
    expect(boxes[0].height).toBe(boxes[2].height);
    expect(boxes[2].x + boxes[2].width).toBeCloseTo(1000);
    expect(boxes[5].x + boxes[5].width).toBeCloseTo(1000);
    expect(boxes[0].width / boxes[0].height).toBeCloseTo(0.5);
    expect(boxes[1].width / boxes[1].height).toBeCloseTo(2);
    expect(boxes[6].width).toBeLessThan(500);
  });
  it("masonry balances the shortest column instead of forcing rows", () => {
    const { boxes } = mediaLayout([0.5, 2, 1, 1], 410, {
      mode: "masonry",
      columns: 2,
    });
    expect(boxes[2].x).toBe(boxes[1].x);
    expect(boxes[2].y).toBeLessThan(boxes[0].height);
  });
  it("tiles make square cells with the chosen row count", () => {
    const { boxes } = mediaLayout(ratios, 1000, { mode: "tiles", columns: 3 });
    expect(boxes[0].width).toBe(boxes[0].height);
    expect(boxes[2].y).toBe(0);
    expect(boxes[3].x).toBe(0);
    expect(boxes[3].y).toBeGreaterThan(0);
  });
  it("invalid saved preferences and empty data have safe defaults", () => {
    expect(parseMediaView({ mode: "other", columns: -2 })).toEqual({
      mode: "adaptive",
      columns: 5,
    });
    expect(parseMediaView({ mode: "tiles", columns: 3.5 })).toEqual({
      mode: "tiles",
      columns: 5,
    });
    expect(mediaLayout([], 1000, { mode: "tiles", columns: 3 })).toEqual({
      boxes: [],
      height: 0,
    });
    expect(mediaLayout([1], 0, { mode: "tiles", columns: 3 })).toEqual({
      boxes: [],
      height: 0,
    });
  });
});
