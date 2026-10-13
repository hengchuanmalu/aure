export type MediaLayoutMode = "masonry" | "tiles" | "adaptive";
export type MediaView = { mode: MediaLayoutMode; columns: number };
export type MediaBox = { x: number; y: number; width: number; height: number };
export const defaultMediaView: MediaView = { mode: "adaptive", columns: 5 };
export const mediaViewStorageKey = "aure.media-view.v1";

/** Rebuilt with layout geometry, never on scroll. Subtrees outside the viewport
 * are skipped, including masonry columns with very tall images. */
export function mediaViewportIndex(boxes: readonly MediaBox[]) {
  let leaves = 1;
  while (leaves < boxes.length) leaves *= 2;
  const tops = new Float64Array(leaves * 2).fill(Infinity);
  const bottoms = new Float64Array(leaves * 2).fill(-Infinity);
  boxes.forEach((box, index) => {
    tops[leaves + index] = box.y;
    bottoms[leaves + index] = box.y + box.height;
  });
  for (let node = leaves - 1; node > 0; node--) {
    tops[node] = Math.min(tops[node * 2], tops[node * 2 + 1]);
    bottoms[node] = Math.max(bottoms[node * 2], bottoms[node * 2 + 1]);
  }
  return {
    visible(start: number, end: number): number[] {
      const result: number[] = [];
      const visit = (node: number) => {
        if (tops[node] > end || bottoms[node] < start) return;
        if (node >= leaves) { result.push(node - leaves); return; }
        visit(node * 2);
        visit(node * 2 + 1);
      };
      if (start <= end) visit(1);
      return result;
    },
  };
}

export function parseMediaView(value: unknown): MediaView {
  const candidate = value as Partial<MediaView> | null;
  return {
    mode:
      candidate &&
      ["masonry", "tiles", "adaptive"].includes(candidate.mode || "")
        ? candidate.mode!
        : defaultMediaView.mode,
    columns:
      candidate &&
      Number.isInteger(candidate.columns) &&
      candidate.columns! >= 1 &&
      candidate.columns! <= 10
        ? candidate.columns!
        : defaultMediaView.columns,
  };
}

/** Display geometry only; no catalog updates or original-image decoding. */
export function mediaLayout(
  ratios: readonly number[],
  width: number,
  view: MediaView,
  gap = 10,
): {
  boxes: MediaBox[];
  height: number;
} {
  if (!(width > 0) || !ratios.length) return { boxes: [], height: 0 };
  const { mode, columns } = parseMediaView(view);
  const spacing = Math.min(Math.max(0, gap), width / (columns * 2));
  const cellWidth = (width - (columns - 1) * spacing) / columns;
  const aspects = ratios.map((ratio) =>
    Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
  );
  const boxes: MediaBox[] = [];
  if (mode === "adaptive") {
    // Each complete row has the selected item count. Widths follow the media's
    // aspect ratios; the final partial row keeps a normal height rather than expanding.
    const average =
      aspects.reduce((sum, ratio) => sum + ratio, 0) / aspects.length;
    const targetHeight = cellWidth / average;
    let y = 0;
    for (let start = 0; start < aspects.length; start += columns) {
      const row = aspects.slice(start, start + columns);
      const available = width - (row.length - 1) * spacing;
      const filledHeight =
        available / row.reduce((sum, ratio) => sum + ratio, 0);
      const height =
        row.length === columns
          ? filledHeight
          : Math.min(targetHeight, filledHeight);
      let x = 0;
      for (const ratio of row) {
        boxes.push({ x, y, width: height * ratio, height });
        x += height * ratio + spacing;
      }
      y += height + spacing;
    }
    return { boxes, height: y - spacing };
  }
  const bottoms = Array<number>(columns).fill(0);
  for (let index = 0; index < aspects.length; index++) {
    let column = index % columns;
    if (mode === "masonry") {
      column = 0;
      for (let next = 1; next < columns; next++) {
        if (bottoms[next] < bottoms[column]) column = next;
      }
    }
    const height = mode === "tiles" ? cellWidth : cellWidth / aspects[index];
    boxes.push({
      x: column * (cellWidth + spacing),
      y: bottoms[column],
      width: cellWidth,
      height,
    });
    bottoms[column] += height + spacing;
  }
  return { boxes, height: Math.max(...bottoms) - spacing };
}
