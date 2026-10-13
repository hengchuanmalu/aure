import { animate, type AnimationPlaybackControls } from "motion";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useUiMotion } from "@/ui/useUiMotion";

type Bounds = { x: number; y: number; width: number; height: number };
const interpolate = (from: Bounds, to: Bounds, progress: number): Bounds => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
  width: from.width + (to.width - from.width) * progress,
  height: from.height + (to.height - from.height) * progress,
});
function bounds(element: HTMLElement): Bounds {
  const card = element.closest(".album-card");
  let x = 0,
    y = 0;
  for (
    let node: HTMLElement | null = element;
    node && node !== card;
    node = node.offsetParent as HTMLElement | null
  ) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, width: element.clientWidth, height: element.clientHeight };
}

/** A cold layout must not spend the transition's duration before its first tick. */
function firstFrameDriver(update: (time: number) => void) {
  let frame = 0;
  let previous: number | null = null;
  let elapsed = 0;
  let running = false;
  const tick = (timestamp: number) => {
    if (!running) return;
    // Match Motion's 40ms frame-delta ceiling: startup work cannot consume
    // the entire transition between the initial draw and the next paint.
    if (previous !== null) elapsed += Math.min(timestamp - previous, 40);
    previous = timestamp;
    update(elapsed);
    if (running) frame = requestAnimationFrame(tick);
  };
  return {
    start: () => {
      running = true;
      frame = requestAnimationFrame(tick);
    },
    stop: () => {
      running = false;
      cancelAnimationFrame(frame);
    },
    now: () => elapsed,
  };
}

/** Retarget from the displayed geometry when virtual rows resize mid-flight.
 * The image plane keeps its natural ratio while the crop frame changes shape. */
export function useAlbumCoverTransition(
  frame: RefObject<HTMLDivElement | null>,
  plane: RefObject<HTMLDivElement | null>,
  view: string,
  enabled: boolean,
  ratio: number,
  cropX: number,
  cropY: number,
) {
  const { reduced, transitions } = useUiMotion();
  const current = useRef<Bounds | null>(null),
    target = useRef<Bounds | null>(null),
    previousView = useRef(view);
  const controls = useRef<AnimationPlaybackControls | null>(null);
  const generation = useRef(0);
  const startFrame = useRef(0);
  const projectionConfig = useRef({ ratio, cropX, cropY });
  const clear = () => {
    if (frame.current) frame.current.style.removeProperty("transform");
    if (plane.current) plane.current.style.removeProperty("transform");
  };
  useLayoutEffect(() => {
    const element = frame.current,
      image = plane.current;
    if (!enabled || !element || !image) return;
    const update = () => {
      const next = bounds(element),
        changedView = previousView.current !== view;
      // Keep a pending view change until the element has measurable geometry.
      if (!next.width || !next.height) return;
      previousView.current = view;
      const oldTarget = target.current;
      const previousConfig = projectionConfig.current;
      const changedConfig =
        previousConfig.ratio !== ratio ||
        previousConfig.cropX !== cropX ||
        previousConfig.cropY !== cropY;
      projectionConfig.current = { ratio, cropX, cropY };
      if (
        !changedView &&
        !changedConfig &&
        oldTarget &&
        Object.keys(next).every(
          (key) => next[key as keyof Bounds] === oldTarget[key as keyof Bounds],
        ) &&
        !reduced
      )
        return;
      const from = current.current;
      const continuing = !!controls.current || !!startFrame.current;
      cancelAnimationFrame(startFrame.current);
      startFrame.current = 0;
      controls.current?.stop();
      controls.current = null;
      const token = ++generation.current;
      target.current = next;
      if (!from || reduced || (!changedView && !continuing)) {
        current.current = next;
        clear();
        return;
      }
      const imageWidth = Math.max(next.width, next.height * ratio),
        imageHeight = imageWidth / ratio;
      const imageLeft = (next.width - imageWidth) * cropX,
        imageTop = (next.height - imageHeight) * cropY;
      const draw = (progress: number) => {
        const value = interpolate(from, next, progress);
        current.current = value;
        const sx = value.width / next.width,
          sy = value.height / next.height;
        element.style.transformOrigin = "0 0";
        image.style.transformOrigin = "0 0";
        element.style.transform = `translate(${value.x - next.x}px, ${value.y - next.y}px) scale(${sx}, ${sy})`;
        const width = Math.max(value.width, value.height * ratio),
          height = width / ratio;
        const left = (value.width - width) * cropX,
          top = (value.height - height) * cropY;
        image.style.transform = `translate(${left / sx - imageLeft}px, ${top / sy - imageTop}px) scale(${width / imageWidth / sx}, ${height / imageHeight / sy})`;
      };
      draw(0);
      // Begin after React and the virtual grid finish the synchronous commit.
      startFrame.current = requestAnimationFrame(() => {
        startFrame.current = 0;
        controls.current = animate(0, 1, {
          ...transitions.reflow,
          startTime: 0,
          driver: firstFrameDriver,
          onUpdate: draw,
          onComplete: () => {
            if (generation.current !== token) return;
            current.current = next;
            controls.current = null;
            clear();
          },
        });
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  });
  useLayoutEffect(
    () => () => {
      ++generation.current;
      controls.current?.stop();
      cancelAnimationFrame(startFrame.current);
    },
    [],
  );
}
