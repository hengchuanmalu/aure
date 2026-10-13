import { mediaLayout, mediaViewportIndex, type MediaView } from "@/domain/media-layout";
import { type MediaItem } from '@/domain/types';
import { useUiMotion } from "@/ui/useUiMotion";
import { motion } from "motion/react";
import {
useLayoutEffect,
useMemo,
useRef,
useState,
type ReactNode,
} from "react";

type Props = {
  items: readonly MediaItem[];
  view: MediaView;
  reducedMotion: boolean;
  onReflow: () => void;
  render: (item: MediaItem) => ReactNode;
};

/** Geometry virtualization keeps all three layouts bounded and in media order. */
export function MediaLayoutGrid({
  items,
  view,
  reducedMotion,
  onReflow,
  render,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({
    width: 0,
    top: 0,
    scroll: 0,
    height: 900,
  });
  const [ratios, setRatios] = useState<Map<string, number>>(() => new Map());
  const pending = useRef(new Map<string, number>());
  const ratioFrame = useRef(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { reduced, transitions } = useUiMotion();
  const animate = !reducedMotion && !reduced;

  useLayoutEffect(() => {
    const element = root.current!;
    let frame = 0;
    const measure = () => {
      const next = {
        width: element.clientWidth,
        top: element.getBoundingClientRect().top + window.scrollY,
        scroll: window.scrollY,
        height: window.innerHeight,
      };
      setBounds((old) =>
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
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(ratioFrame.current);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  const layout = useMemo(
    () =>
      mediaLayout(
        items.map(
          (item) =>
            ratios.get(item.id) ||
            (item.width > 0 && item.height > 0 ? item.width / item.height : 1),
        ),
        bounds.width,
        view,
      ),
    [items, ratios, bounds.width, view],
  );
  const viewportIndex = useMemo(() => mediaViewportIndex(layout.boxes), [layout]);
  const indexById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items]);
  const previous = useRef<{ layout: typeof layout; ids: string[] } | null>(
    null,
  );
  useLayoutEffect(() => {
    const old = previous.current;
    const changed =
      old &&
      (old.layout.boxes.length !== layout.boxes.length ||
        layout.boxes.some((box, i) => {
          const before = old.layout.boxes[i];
          return (
            !before ||
            box.x !== before.x ||
            box.y !== before.y ||
            box.width !== before.width ||
            box.height !== before.height
          );
        }));
    if (changed) {
      onReflow();
      const top = root.current!.getBoundingClientRect().top + window.scrollY;
      const viewport = window.scrollY - top;
      // Keep the first visible media at the same reading position on reflow.
      if (viewport > 0) {
        const index = old.layout.boxes.findIndex(
          (box) => box.y + box.height > viewport,
        );
        const nextIndex = indexById.get(old.ids[index]) ?? -1;
        const before = old.layout.boxes[index],
          after = layout.boxes[nextIndex];
        if (before && after) {
          const offset = Math.min(
            Math.max(0, viewport - before.y),
            Math.max(0, after.height - 1),
          );
          window.scrollTo({ top: top + after.y + offset, behavior: "instant" });
        }
      }
    }
    previous.current = { layout, ids: items.map((item) => item.id) };
  }, [layout, items, onReflow, indexById]);

  const start = bounds.scroll - bounds.top - bounds.height;
  const end = bounds.scroll - bounds.top + bounds.height * 2;
  const focusedIndex = focusId ? (indexById.get(focusId) ?? -1) : -1;
  const visibleIndexes = items.length <= 48
    ? layout.boxes.map((_, index) => index)
    : viewportIndex.visible(start, end);
  if (focusedIndex >= 0) {
    for (let index = Math.max(0, focusedIndex - 1); index <= Math.min(layout.boxes.length - 1, focusedIndex + 1); index++)
      if (!visibleIndexes.includes(index)) visibleIndexes.push(index);
    visibleIndexes.sort((a, b) => a - b);
  }
  return (
    <div
      ref={root}
      className="media-layout"
      data-layout-mode={view.mode}
      data-columns={view.columns}
      data-total-items={items.length}
      data-animated={animate}
      style={{ height: layout.height }}
      onFocusCapture={(event) =>
        setFocusId(
          (event.target as HTMLElement).closest<HTMLElement>("[data-layout-id]")
            ?.dataset.layoutId || null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocusId(null);
      }}
      onLoadCapture={(event) => {
        const image = event.target;
        if (
          !(image instanceof HTMLImageElement) ||
          !image.naturalWidth ||
          !image.naturalHeight
        )
          return;
        const id =
          image.closest<HTMLElement>("[data-layout-id]")?.dataset.layoutId;
        const itemIndex = id ? indexById.get(id) : undefined;
        const item = itemIndex === undefined ? undefined : items[itemIndex];
        if (!id || !item || (item.width > 0 && item.height > 0)) return;
        const ratio = image.naturalWidth / image.naturalHeight;
        if (Math.abs((ratios.get(id) || 0) - ratio) < 0.001) return;
        pending.current.set(id, ratio);
        if (!ratioFrame.current)
          ratioFrame.current = requestAnimationFrame(() => {
            ratioFrame.current = 0;
            const measured = new Map(pending.current);
            pending.current.clear();
            setRatios((old) => new Map([...old, ...measured]));
          });
      }}
    >
      {visibleIndexes.map(index => {
        const box = layout.boxes[index];
        const item = items[index];
        return (
          <motion.div
            key={item.id}
            className="media-layout-item"
            data-layout-id={item.id}
            initial={false}
            animate={{
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            }}
            transition={animate ? transitions.reflow : { duration: 0 }}
          >
            {render(item)}
          </motion.div>
        );
      })}
    </div>
  );
}
