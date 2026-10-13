import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { useUiMotion } from "@/ui/useUiMotion";
import { packGrid } from "@/domain/grid-packing";
import type { CSSProperties } from "react";

type Props<T extends { id: string }> = {
  items: readonly T[];
  className: string;
  render: (item: T, index: number) => ReactNode;
  transitionKey?: string;
  getItemSpan?: (item: T) => number;
  dense?: boolean;
};

/** A single parent keeps each visible card mounted across sorting and size thresholds. */
export function VirtualGrid<T extends { id: string }>({
  items,
  className,
  render,
  transitionKey,
  getItemSpan,
  dense = false,
}: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const { reduced, transitions } = useUiMotion();
  const previousKey = useRef(transitionKey);
  const renderedIds = useRef<string[]>([]);
  const viewportAnchor = useRef<{ id: string; top: number } | null>(null);
  const transitionAnchor = useRef<{ id: string; top: number } | null>(null);
  const captureViewport = useRef(() => {});
  const retainingWindow = useRef(false);
  const anchorReleaseTimer = useRef(0);
  const releaseAfterLayout = () => {
    window.clearTimeout(anchorReleaseTimer.current);
    if (retainingWindow.current || !transitionAnchor.current) return;
    anchorReleaseTimer.current = window.setTimeout(
      () => {
        transitionAnchor.current = null;
      },
      Math.max(100, transitions.reflow.duration * 1000),
    );
  };
  const [retainedIds, setRetainedIds] = useState<string[]>([]);
  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items],
  );
  useLayoutEffect(() => {
    if (previousKey.current === transitionKey) {
      if (reduced) {
        transitionAnchor.current = null;
        setRetainedIds((old) => (old.length ? [] : old));
      }
      return;
    }
    previousKey.current = transitionKey;
    if (reduced) {
      transitionAnchor.current = null;
      retainingWindow.current = false;
      window.clearTimeout(anchorReleaseTimer.current);
      setRetainedIds((old) => (old.length ? [] : old));
      return;
    }
    transitionAnchor.current =
      window.scrollY > 0 ? viewportAnchor.current : null;
    retainingWindow.current = true;
    window.clearTimeout(anchorReleaseTimer.current);
    // Keep only the previous visible window while the column count changes.
    setRetainedIds(renderedIds.current);
    const timer = window.setTimeout(
      () => {
        retainingWindow.current = false;
        setRetainedIds([]);
        releaseAfterLayout();
      },
      transitions.reflow.duration * 1000 + 50,
    );
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(anchorReleaseTimer.current);
    };
  }, [transitionKey, reduced, transitions.reflow.duration]);
  const [geometry, setGeometry] = useState({
    columns: 4,
    gap: 24,
    rowGap: 24,
    width: 1000,
    offset: 0,
  });
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!transitionKey) return;
    let frame = 0;
    const capture = (event?: Event) => {
      if (transitionAnchor.current) return;
      const nodes =
        root.current!.querySelectorAll<HTMLElement>("[data-grid-id]");
      const bounds = new Map<HTMLElement, DOMRect>();
      const rect = (node: HTMLElement) => {
        let result = bounds.get(node);
        if (!result) { result = node.getBoundingClientRect(); bounds.set(node, result); }
        return result;
      };
      const visible = (node: HTMLElement) => {
        const r = rect(node);
        return r.bottom > 120 && r.top < innerHeight;
      };
      // A column change can put an earlier album in the same visible row.
      // Keep the album the user was browsing across the reverse transition.
      const node =
        [...nodes].find(
          (node) =>
            node.dataset.gridId === viewportAnchor.current?.id && visible(node),
        ) ?? [...nodes].find(visible);
      // A render during projection must not overwrite the saved position.
      if (!event && node?.dataset.gridId === viewportAnchor.current?.id) return;
      viewportAnchor.current = node
        ? { id: node.dataset.gridId!, top: rect(node).top }
        : null;
    };
    const scheduleCapture = (event: Event) => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; capture(event); });
    };
    const release = () => {
      transitionAnchor.current = null;
      viewportAnchor.current = null;
    };
    captureViewport.current = capture;
    capture();
    window.addEventListener("scroll", scheduleCapture, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    return () => {
      captureViewport.current = () => {};
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleCapture);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
    };
  }, [transitionKey]);
  useEffect(() => {
    captureViewport.current();
  });
  useLayoutEffect(() => {
    const element = root.current!;
    let frame = 0;
    let scrollFrame = 0;
    const measure = () => {
      const css = getComputedStyle(element);
      const next = {
        columns: Math.max(1, css.gridTemplateColumns.split(" ").length),
        gap: parseFloat(css.columnGap) || 0,
        rowGap: parseFloat(css.rowGap) || 0,
        width: element.clientWidth,
        offset: element.getBoundingClientRect().top + window.scrollY,
      };
      setGeometry((old) =>
        Object.keys(next).every(
          (key) =>
            Math.abs(
              next[key as keyof typeof next] - old[key as keyof typeof old],
            ) < 1,
        )
          ? old
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    // Scrolling can shift the grid's document offset, but cannot change its
    // columns or width. Read CSS geometry only on a resize notification.
    const scroll = () => {
      if (!frame && !scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const offset = element.getBoundingClientRect().top + window.scrollY;
        setGeometry(old => Math.abs(old.offset - offset) < 1 ? old : { ...old, offset });
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scroll);
    };
  }, [className]);
  const width =
    (geometry.width - geometry.gap * (geometry.columns - 1)) / geometry.columns;
  const estimatedHeight = className.includes("models-grid")
    ? 140
    : className.includes("media-grid")
      ? (width * 2) / 3
      : className.includes("cover-grid")
        ? (width * 4) / 3
        : 320;
  const packing = useMemo(
    () => packGrid(items, geometry.columns, getItemSpan, dense),
    [items, geometry.columns, getItemSpan, dense],
  );
  const rows = packing.rows.length;
  const focusedRow =
    packing.rowByIndex[focused ? (indexById.get(focused) ?? -1) : -1] ?? -1;
  const virtual = useWindowVirtualizer({
    count: rows,
    estimateSize: () => estimatedHeight + geometry.rowGap,
    overscan: 2,
    scrollMargin: geometry.offset,
    useFlushSync: false,
    rangeExtractor: (range) => {
      if (items.length <= 48)
        return Array.from({ length: rows }, (_, index) => index);
      const indexes = new Set(defaultRangeExtractor(range));
      for (const id of retainedIds) {
        const index = indexById.get(id);
        if (index !== undefined) indexes.add(packing.rowByIndex[index]);
      }
      if (focusedRow >= 0)
        for (let i = focusedRow - 1; i <= focusedRow + 1; i++)
          if (i >= 0 && i < rows) indexes.add(i);
      return [...indexes].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    virtual.measure();
  }, [geometry.columns, geometry.width, className, virtual]);
  const visibleRows = virtual.getVirtualItems();
  useLayoutEffect(() => {
    renderedIds.current = visibleRows.flatMap((row) =>
      packing.rows[row.index].map((slot) => items[slot.index].id),
    );
  });
  useLayoutEffect(() => {
    const anchor = transitionAnchor.current;
    const element = root.current;
    if (
      !anchor ||
      !element ||
      getComputedStyle(element).gridTemplateColumns.split(" ").length !==
        geometry.columns
    )
      return;
    const node = [
      ...element.querySelectorAll<HTMLElement>("[data-grid-id]"),
    ].find((node) => node.dataset.gridId === anchor.id);
    if (!node) return;
    // offsetTop ignores Motion's temporary projection transform.
    const delta =
      element.getBoundingClientRect().top + node.offsetTop - anchor.top;
    if (Math.abs(delta) > 1)
      window.scrollBy({ top: delta, behavior: "instant" });
  });
  const visibleKey = visibleRows.map((row) => row.index).join(",");
  useLayoutEffect(() => {
    const element = root.current!;
    const heights = new Map<Element, number>();
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        heights.set(entry.target, entry.contentRect.height);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rowHeights = new Map<number, number>();
        for (const [node, height] of heights)
          if (node.isConnected) {
            const index = Number((node as HTMLElement).dataset.index);
            rowHeights.set(index, Math.max(rowHeights.get(index) || 0, height));
          }
        for (const [index, height] of rowHeights)
          virtual.resizeItem(index, height + geometry.rowGap);
        // Removing the retained window can produce one final row measurement.
        // Release the anchor only after those measurements have settled.
        releaseAfterLayout();
      });
    });
    for (const child of element.children) observer.observe(child);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [items, packing, visibleKey, geometry.rowGap, virtual]);
  return (
    <div
      ref={root}
      className={`${className} virtual-grid`}
      data-total-items={items.length}
      style={{
        height: Math.max(0, virtual.getTotalSize() - geometry.rowGap),
        position: "relative",
      }}
      onFocusCapture={(event) =>
        setFocused(
          (event.target as HTMLElement).closest<HTMLElement>("[data-grid-id]")
            ?.dataset.gridId || null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocused(null);
      }}
    >
      {visibleRows.flatMap((row) =>
        packing.rows[row.index].map(({ index, column, span }) => (
          <motion.div
            key={items[index].id}
            data-index={row.index}
            data-grid-id={items[index].id}
            layout={transitionKey && !reduced ? "position" : false}
            layoutDependency={`${transitionKey}:${geometry.columns}:${geometry.width}:${row.index}:${span}`}
            initial={false}
            transition={transitions.reflow}
            style={
              {
                position: "absolute",
                left: column * (width + geometry.gap),
                width: width * span + geometry.gap * (span - 1),
                "--virtual-grid-cell-width": `${width}px`,
                ...(transitionKey
                  ? { top: row.start - geometry.offset }
                  : {
                      transform: `translateY(${row.start - geometry.offset}px)`,
                    }),
              } as CSSProperties & { "--virtual-grid-cell-width": string }
            }
          >
            {render(items[index], index)}
          </motion.div>
        )),
      )}
    </div>
  );
}
