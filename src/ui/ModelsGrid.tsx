import { catalog } from "@/domain/catalog";
import type { ModelProfile } from "@/domain/types";
import { useData } from "@/state/data-context";
import { ModelCoverPreview } from "@/ui/ModelCoverPreview";
import { VirtualGrid } from "@/ui/VirtualGrid";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

type Item = { id: string; model: ModelProfile; letter: string };
type Session = { id: string; slots: number; keyboard: boolean };
type Bounds = { left: number; right: number; top: number; bottom: number };

export function ModelsGrid({ items }: { items: readonly Item[] }) {
  const { db } = useData();
  const counts = catalog(db).modelCounts;
  const root = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const live = useRef(session);
  live.current = session;
  const timers = useRef({ open: 0, close: 0, pending: "", lockedUntil: 0 });
  const origin = useRef<Bounds | null>(null);
  const openingPoint = useRef({ x: 0, y: 0 });
  const itemOrder = items.map((item) => item.id).join("\0");
  const cancelPending = useCallback(() => {
    window.clearTimeout(timers.current.open);
    timers.current.pending = "";
  }, []);
  const close = useCallback(() => {
    cancelPending();
    window.clearTimeout(timers.current.close);
    origin.current = null;
    live.current = null;
    setSession(null);
  }, [cancelPending]);
  useEffect(() => {
    return () => {
      window.clearTimeout(timers.current.open);
      window.clearTimeout(timers.current.close);
    };
  }, []);
  useEffect(() => {
    close();
  }, [itemOrder, close]);
  useEffect(() => {
    if (!session) return;
    const pointer = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const group = [
        ...root.current!.querySelectorAll<HTMLElement>(
          "[data-model-preview-id]",
        ),
      ].find((node) => node.dataset.modelPreviewId === live.current?.id);
      if (!group) {
        close();
        return;
      }
      const current = group.getBoundingClientRect();
      const old = origin.current;
      const inside = (r: Bounds) =>
        event.clientX >= r.left - 12 &&
        event.clientX <= r.right + 12 &&
        event.clientY >= r.top - 12 &&
        event.clientY <= r.bottom + 12;
      // Keep a bridge from the old avatar position until the pointer reaches the
      // expanded group, including when that group wraps onto the next row.
      const bridge = old
        ? {
            left: Math.min(old.left, current.left),
            right: Math.max(old.right, current.right),
            top: Math.min(old.top, current.top),
            bottom: Math.max(old.bottom, current.bottom),
          }
        : current;
      if (inside(bridge)) {
        window.clearTimeout(timers.current.close);
        if (inside(current) && performance.now() > timers.current.lockedUntil)
          origin.current = null;
      } else {
        window.clearTimeout(timers.current.close);
        timers.current.close = window.setTimeout(close, 160);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focused = document.activeElement;
      if (focused instanceof Element && focused.closest(".model-cover-preview"))
        focused
          .closest(".model-preview-group")
          ?.querySelector<HTMLElement>(".model-card")
          ?.focus({ preventScroll: true });
      close();
    };
    const scroll = () => {
      // Virtual row measurement may preserve the viewport with a programmatic
      // scroll during reflow. Explicit wheel/touch scrolling still closes at once.
      if (performance.now() > timers.current.lockedUntil) close();
    };
    document.addEventListener("pointermove", pointer);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("touchmove", close, { passive: true });
    return () => {
      document.removeEventListener("pointermove", pointer);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("touchmove", close);
    };
  }, [session?.id, close]);
  const requestOpen = (
    item: Item,
    node: HTMLElement,
    event?: PointerEvent<HTMLElement>,
  ) => {
    const count = item.model.albumCount ?? counts.get(item.id) ?? 0;
    if (!count || live.current?.id === item.id) return;
    if (event) {
      if (
        event.pointerType !== "mouse" ||
        !matchMedia("(hover: hover) and (pointer: fine)").matches
      )
        return;
      // Layout moving a card underneath a stationary pointer is not a new hover.
      if (
        live.current &&
        Math.hypot(
          event.clientX - openingPoint.current.x,
          event.clientY - openingPoint.current.y,
        ) < 6
      )
        return;
    }
    if (timers.current.pending === item.id) return;
    cancelPending();
    timers.current.pending = item.id;
    const point = event ? { x: event.clientX, y: event.clientY } : null;
    const open = () => {
      timers.current.pending = "";
      if (!node.isConnected || (point && !node.matches(":hover"))) return;
      window.clearTimeout(timers.current.close);
      origin.current = node.getBoundingClientRect();
      if (point) openingPoint.current = point;
      timers.current.lockedUntil = performance.now() + 260;
      const next = { id: item.id, slots: Math.min(3, count), keyboard: !point };
      live.current = next;
      setSession(next);
    };
    if (event)
      timers.current.open = window.setTimeout(
        open,
        Math.max(150, timers.current.lockedUntil - performance.now()),
      );
    else open();
  };
  const span = useCallback(
    (item: Item) =>
      session?.id === item.id ? 1 + Math.ceil(session.slots / 2) : 1,
    [session?.id, session?.slots],
  );
  return (
    <div
      ref={root}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (
          live.current?.keyboard &&
          (!(next instanceof Element) ||
            next
              .closest("[data-model-preview-id]")
              ?.getAttribute("data-model-preview-id") !== live.current.id)
        )
          close();
      }}
    >
      <VirtualGrid
        className="models-grid"
        items={items}
        getItemSpan={span}
        dense={!!session}
        transitionKey={
          session?.keyboard ? undefined : (session?.id ?? "closed")
        }
        render={(item) => (
          <div data-model-initial={item.letter}>
            <ModelCoverPreview
              model={item.model}
              open={session?.id === item.id}
              slots={session?.slots ?? 3}
              onTrigger={(node, event) => requestOpen(item, node, event)}
              onResolved={(count) => {
                if (live.current?.id !== item.id) return;
                if (!count) close();
                else if (count !== live.current.slots)
                  setSession({ ...live.current, slots: count });
              }}
            />
          </div>
        )}
      />
    </div>
  );
}
