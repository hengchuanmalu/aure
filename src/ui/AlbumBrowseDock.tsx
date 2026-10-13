import { Button } from '@/ui/ActionButton';
import { useUiMotion } from '@/ui/useUiMotion';
import { Play } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export const AlbumBrowseDockContext = createContext<{
  target: RefObject<HTMLSpanElement | null>;
  edit: RefObject<HTMLButtonElement | null>;
  host: HTMLDivElement | null;
  setDocked: (docked: boolean) => void;
} | null>(null);

const MotionButton = motion.create(Button);

export function AlbumBrowseAction({ disabled, onBrowse, contentStart }: {
  disabled: boolean; onBrowse: () => void; contentStart: RefObject<HTMLDivElement | null>;
}) {
  const dock = useContext(AlbumBrowseDockContext);
  const slot = useRef<HTMLSpanElement>(null);
  const [positioned, setPositioned] = useState(false);
  const [docked, setDocked] = useState(false);
  const transform = useMotionValue('translate3d(0px, 0px, 0px)');
  const { reduced, transitions } = useUiMotion();
  const target = dock?.target, edit = dock?.edit, host = dock?.host, setHeaderDocked = dock?.setDocked;
  useLayoutEffect(() => {
    const anchor = slot.current;
    const destination = target?.current;
    const editButton = edit?.current;
    if (!anchor || !destination || !editButton || !host || !setHeaderDocked) return;
    let frame = 0, attached = false, initialized = false, keyboardScroll = false;
    let previousScroll = window.scrollY, snapping = false;
    let animation: ReturnType<typeof animate> | undefined;
    const pose = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0px)`;
    const stop = () => {
      animation?.stop();
      animation = undefined;
      snapping = false;
    };
    const update = () => {
      const source = anchor.getBoundingClientRect();
      const header = editButton.closest('.topbar')!.getBoundingClientRect();
      const end = destination.getBoundingClientRect();
      const currentScroll = window.scrollY;
      const forward = currentScroll > previousScroll;
      previousScroll = currentScroll;
      if (snapping) return;
      // Catch only within 8px of the edit button's lower edge. Release at 24px
      // to avoid chatter when a trackpad pauses or reverses near the contact point.
      const next = source.top - end.bottom <= (attached ? 24 : 8);
      const changed = next !== attached;
      if (!initialized || next !== attached) {
        attached = next;
        setDocked(next);
        setHeaderDocked(next);
        if (next && document.activeElement === editButton)
          host.querySelector<HTMLButtonElement>('.album-browse')?.focus({ preventScroll: true });
      }
      stop();
      const content = contentStart.current?.getBoundingClientRect();
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const finishScroll = content ? Math.min(maxScroll, currentScroll + content.top - header.bottom) : currentScroll;
      const settle = initialized && changed && attached && forward && !keyboardScroll &&
        !!content && finishScroll > currentScroll && source.top >= end.top;
      if (settle) {
        // One progress value keeps button contact and the cover/content handoff
        // in sync. Further input can interrupt it; ordinary gallery scrolling stays native.
        const apply = (progress: number) => {
          window.scrollTo({ top: currentScroll + (finishScroll - currentScroll) * progress, behavior: 'instant' });
          transform.set(pose(end.left, source.top + (end.top - source.top) * progress));
        };
        transform.set(pose(end.left, source.top));
        if (reduced) apply(1);
        else {
          snapping = true;
          animation = animate(0, 1, {
            ...transitions.presence,
            onUpdate: apply,
            onComplete: () => { snapping = false; animation = undefined; schedule(); },
          });
        }
      } else if (initialized && changed && !attached && !reduced && !keyboardScroll) {
        animation = animate(transform, pose(end.left, source.top), transitions.selection);
      } else transform.set(pose(end.left, attached ? end.top : source.top));
      initialized = true;
      setPositioned(true);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const keyboard = () => { keyboardScroll = true; stop(); schedule(); };
    const pointer = () => { keyboardScroll = false; stop(); schedule(); };
    const resize = () => { stop(); schedule(); };
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(destination);
    observer.observe(editButton.closest('.topbar')!);
    observer.observe(anchor.closest('.album-hero')!);
    window.addEventListener('scroll', schedule, { passive: true });
    if (contentStart.current) observer.observe(contentStart.current);
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('keydown', keyboard);
    window.addEventListener('wheel', pointer, { passive: true });
    window.addEventListener('pointerdown', pointer, { passive: true });
    window.addEventListener('touchstart', pointer, { passive: true });
    window.addEventListener('touchmove', pointer, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      stop();
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('wheel', pointer);
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('touchstart', pointer);
      window.removeEventListener('touchmove', pointer);
      setHeaderDocked(false);
    };
  }, [target, edit, host, contentStart, setHeaderDocked, reduced, transitions.selection, transitions.presence, transform]);

  const button = <MotionButton className="album-browse" size="lg" variant="default" icon={<Play />}
    disabled={disabled} onClick={onBrowse} data-docked={docked} data-positioned={positioned}
    style={{ transform }}>
    浏览写真
  </MotionButton>;
  return <>
    <span ref={slot} className="album-browse-origin" aria-hidden="true" />
    {host && createPortal(button, host)}
  </>;
}
