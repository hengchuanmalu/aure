export type GridSlot = { index: number; column: number; span: number };

/** Wide items reserve real cells. Dense mode backfills row gaps with later items. */
export function packGrid<T>(
  items: readonly T[],
  columns: number,
  spanFor?: (item: T) => number,
  dense = false,
) {
  const rows: GridSlot[][] = [];
  const rowByIndex: number[] = [];
  const used: number[] = [];
  let firstOpen = 0;
  items.forEach((item, index) => {
    const span = Math.min(
      columns,
      Math.max(1, Math.floor(spanFor?.(item) ?? 1)),
    );
    let row = dense ? firstOpen : Math.max(0, rows.length - 1);
    while (row < rows.length && used[row] + span > columns) row++;
    if (row === rows.length) {
      rows.push([]);
      used.push(0);
    }
    rows[row].push({ index, column: used[row], span });
    rowByIndex[index] = row;
    used[row] += span;
    while (firstOpen < rows.length && used[firstOpen] === columns) firstOpen++;
  });
  return { rows, rowByIndex };
}
