import { type MediaItem } from '@/domain/types';
import { readCandidates } from '@/infrastructure/desktop-repository';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { Photo } from "@/ui/Photo";
import { useUiMotion } from "@/ui/useUiMotion";
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play } from 'lucide-react';
import { useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';

const ITEM_WIDTH = 94;
const PAGE_SIZE = 48;

/** A continuous track with finite native reads and a bounded page cache. */
export function ViewerFilmstrip({ sequence, total, selectedIndex, query, remote, current, onChoose }: {
  sequence: readonly string[]; total: number; selectedIndex: number;
  query: Record<string, unknown>; remote: boolean; current: MediaItem; onChoose: (id: string) => void;
}) {
  const { db } = useData();
  const { reduced } = useUiMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(new Map<number, MediaItem[]>());
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [intro, setIntro] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const visible = intro || hovered || keyboardFocus;
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 2000);
    return () => clearTimeout(timer);
  }, []);
  const virtual = useVirtualizer({ count: total, horizontal: true, getScrollElement: () => viewport.current,
    estimateSize: () => ITEM_WIDTH, overscan: 3, useFlushSync: false,
    initialOffset: Math.max(0, selectedIndex - 4) * ITEM_WIDTH,
  });
  const cells = virtual.getVirtualItems();
  // Removing the current favorite retains it as the viewer's temporary anchor.
  const retainedAnchor = remote && query.favorite === true && !current.favorite;
  const sourceIndex = (index: number) => retainedAnchor && index > selectedIndex ? index - 1 : index;
  const requiredKey = [...new Set(cells.filter(cell => !(retainedAnchor && cell.index === selectedIndex))
    .map(cell => Math.floor(sourceIndex(cell.index) / PAGE_SIZE)))].join(',');
  const queryKey = JSON.stringify(query);
  const byId = useMemo(() => new Map(db.media.map(item => [item.id, item])), [db.media]);

  useEffect(() => {
    if (!remote || !requiredKey) return;
    let alive = true;
    const required = requiredKey.split(',').map(Number);
    const missing = required.filter(index => !pages.has(index));
    if (!missing.length) return;
    setError('');
    void Promise.all(missing.map(async index => ({ index, result: await readCandidates<MediaItem>('media', index, JSON.parse(queryKey)) })))
      .then(loaded => {
        if (!alive) return;
        setPages(previous => {
          const next = new Map(previous);
          for (const page of loaded) next.set(page.index, page.result.items);
          for (const index of next.keys()) if (!required.includes(index)) next.delete(index);
          return next;
        });
      }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [remote, requiredKey, queryKey, attempt]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Center only after changing the current media; manual scrolling stays independent.
    element.scrollTo({ left: Math.max(0, (selectedIndex + 0.5) * ITEM_WIDTH - element.clientWidth / 2), behavior: 'instant' });
  }, [selectedIndex]);
  const move = (direction: number) => {
    const element = viewport.current!;
    element.scrollBy({ left: direction * Math.max(ITEM_WIDTH, Math.floor(element.clientWidth / ITEM_WIDTH) * ITEM_WIDTH),
      behavior: reduced ? 'instant' : 'smooth' });
  };
  const chooseIndex = (index: number) => {
    const at = sourceIndex(index);
    const item = retainedAnchor && index === selectedIndex ? current
      : remote ? pages.get(Math.floor(at / PAGE_SIZE))?.[at % PAGE_SIZE] : byId.get(sequence[index]);
    if (item) onChoose(item.id);
  };
  return <div className="viewer-filmstrip-zone" tabIndex={0} role="group" aria-label="显示写真集缩略图"
    onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={() => { setHovered(false); setIntro(false); }}
    onPointerDownCapture={event => { setKeyboardFocus(false); if (event.pointerType === 'touch') setHovered(true); }}
    onFocusCapture={event => { if (event.target.matches(':focus-visible')) setKeyboardFocus(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setKeyboardFocus(false); }}
    onKeyDownCapture={() => setKeyboardFocus(true)}>
  <div className="viewer-filmstrip" role="group" aria-label="写真集缩略图" data-visible={visible} data-reduced-motion={reduced} inert={!visible}
    style={{ transitionDuration: reduced ? '0ms' : undefined }}>
    <div className="viewer-filmstrip-scroll" ref={viewport} tabIndex={0} aria-label="滚动浏览缩略图"
      onWheel={event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
      }} onKeyDown={event => {
        // Keep thumbnail navigation separate from video seeking and image zoom.
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-thumbnail-index]');
        if (event.key === ' ' && button) {
          event.stopPropagation();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.stopPropagation();
          event.preventDefault();
          event.currentTarget.scrollTo({ left: event.key === 'Home' ? 0 : virtual.getTotalSize(), behavior: reduced ? 'instant' : 'smooth' });
        } else if (!event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.stopPropagation();
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          if (button) chooseIndex(Math.max(0, Math.min(total - 1, Number(button.dataset.thumbnailIndex) + direction)));
          else move(direction);
        }
      }}>
      <div className="viewer-filmstrip-track" style={{ width: virtual.getTotalSize() }}>
        {cells.map(cell => {
          const at = sourceIndex(cell.index);
          const item = retainedAnchor && cell.index === selectedIndex ? current
            : remote ? pages.get(Math.floor(at / PAGE_SIZE))?.[at % PAGE_SIZE] : byId.get(sequence[cell.index]);
          return item ? <button key={item.id} type="button" className="viewer-thumbnail"
            data-media-id={item.id} data-thumbnail-index={cell.index} aria-current={cell.index === selectedIndex ? 'true' : undefined}
            aria-label={`${item.kind === 'video' ? '视频' : '照片'} ${cell.index + 1}：${item.name}`}
            style={{ left: cell.start }} onClick={() => onChoose(item.id)}>
            <Photo src={item.poster || item.src} retryable={false}
              sourcePath={item.kind === 'video' ? remote && !item.poster ? `video:${encodeURIComponent(item.id)}:${db.settings.videoPosterPercent ?? 10}` : undefined : item.sourcePath} />
            {item.kind === 'video' && <span className="viewer-thumbnail-video"><Play size={14} fill="currentColor" /></span>}
          </button> : <span key={cell.index} className="viewer-thumbnail viewer-thumbnail-placeholder" aria-hidden="true"
            style={{ left: cell.start }} />;
        })}
      </div>
    </div>
    {error && <div className="viewer-filmstrip-error" role="alert">缩略图读取失败 <Button size="sm" onClick={() => setAttempt(value => value + 1)}>重试</Button></div>}
  </div></div>;
}
