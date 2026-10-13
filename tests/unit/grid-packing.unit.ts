import { expect, it } from "vitest";
import { packGrid } from "@/domain/grid-packing";

it("packs an expanded group in order, reserving columns and wrapping the last-column group", () => {
  const items = Array.from({ length: 8 }, (_, id) => id);
  const packed = packGrid(items, 6, (id) => (id === 5 ? 3 : 1));
  expect(packed.rows.map((row) => row.map((slot) => slot.index))).toEqual([
    [0, 1, 2, 3, 4],
    [5, 6, 7],
  ]);
  expect(packed.rows[1].map((slot) => [slot.column, slot.span])).toEqual([
    [0, 3],
    [3, 1],
    [4, 1],
  ]);
  expect(packed.rowByIndex).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
});
it("clamps wide groups to narrow grids and preserves ordinary grid packing", () => {
  expect(
    packGrid([0, 1, 2], 1, () => 3).rows.map((row) => row[0].span),
  ).toEqual([1, 1, 1]);
  expect(
    packGrid([0, 1, 2, 3, 4], 2).rows.map((row) =>
      row.map((slot) => slot.index),
    ),
  ).toEqual([[0, 1], [2, 3], [4]]);
});
it("backfills the gap left by a wrapping expanded group with later avatars", () => {
  const packed = packGrid(
    Array.from({ length: 8 }, (_, id) => id),
    6,
    (id) => (id === 5 ? 3 : 1),
    true,
  );
  expect(packed.rows.map((row) => row.map((slot) => slot.index))).toEqual([
    [0, 1, 2, 3, 4, 6],
    [5, 7],
  ]);
  expect(packed.rowByIndex).toEqual([0, 0, 0, 0, 0, 1, 0, 1]);
  expect(packed.rows[0].at(-1)).toEqual({ index: 6, column: 5, span: 1 });
});
