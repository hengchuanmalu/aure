import { avatarImageStyle,clamp,type AvatarCrop } from "@/domain/avatar-crop";
import { type Album,type MediaItem } from '@/domain/types';
import { readCandidates } from '@/infrastructure/desktop-repository';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { Photo } from "@/ui/Photo";
import { useUiMotion } from "@/ui/useUiMotion";
import { defaultRangeExtractor,useVirtualizer } from '@tanstack/react-virtual';
import { Image as ImageIcon,RotateCcw } from 'lucide-react';
import { useEffect,useRef,useState,type KeyboardEvent,type PointerEvent } from 'react';

const coverCrop = (saved?: AvatarCrop): AvatarCrop => ({
  x: clamp(saved?.x ?? 50, 0, 100),
  y: clamp(saved?.y ?? 25, 0, 100),
  zoom: clamp(saved?.zoom ?? 1, 1, 3),
});
const slotWidth = 100;

function CoverFilmstrip({ items, remote, albumId, selected, disabled, visible, onChoose }: {
  items: MediaItem[]; remote: boolean; albumId?: string; selected: Pick<MediaItem, 'id' | 'src'>;
  disabled: boolean; visible: boolean; onChoose: (item: MediaItem) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const { reduced } = useUiMotion();
  const [result, setResult] = useState({ total: 0, pages: new Map<number, MediaItem[]>() });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState<number>();
  const total = remote ? result.total : items.length;
  const virtual = useVirtualizer({ count: total, horizontal: true, getScrollElement: () => viewport.current,
    estimateSize: () => slotWidth, overscan: 3, useFlushSync: false,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...(focused !== undefined ? [focused] : [])])].sort((a, b) => a - b),
  });
  const cells = virtual.getVirtualItems();
  const requiredKey = [...new Set(cells.length ? cells.map(cell => Math.floor(cell.index / 48)) : [0])].join(',');
  useEffect(() => {
    if (!remote) return;
    let alive = true;
    const required = requiredKey.split(',').map(Number);
    const missing = required.filter(index => !result.pages.has(index));
    if (!missing.length) return;
    setError(false);
    void Promise.all(missing.map(async index => ({ index, page: await readCandidates<MediaItem>('media', index, { kind: 'image', album: albumId }) })))
      .then(loaded => {
        if (!alive) return;
        setResult(previous => {
          const pages = new Map(previous.pages);
          for (const entry of loaded) pages.set(entry.index, entry.page.items);
          for (const index of pages.keys()) if (!required.includes(index)) pages.delete(index);
          return { total: loaded[0].page.total, pages };
        });
      }, () => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [remote, albumId, requiredKey, attempt]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if (disabled) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [total, disabled]);
  const move = (direction: number) => viewport.current!.scrollBy({
    left: direction * Math.max(slotWidth, Math.floor(viewport.current!.clientWidth / slotWidth) * slotWidth), behavior: reduced ? 'instant' : 'smooth',
  });
  return <div className="cover-filmstrip" role="group" aria-label="封面缩略图" data-visible={visible} inert={!visible}>
    <div ref={viewport} className="cover-filmstrip-scroll" role="group" aria-label="封面照片" tabIndex={disabled ? -1 : 0}
      onFocusCapture={event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-cover-index]'); if (button) setFocused(Number(button.dataset.coverIndex)); }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(undefined); }}
      onKeyDown={event => {
        if (disabled) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); viewport.current!.scrollTo({ left: event.key === 'Home' ? 0 : virtual.getTotalSize(), behavior: reduced ? 'instant' : 'smooth' }); }
      }}>
      <div className="cover-filmstrip-track" style={{ width: virtual.getTotalSize() }}>
        {cells.map(cell => {
          const item = remote ? result.pages.get(Math.floor(cell.index / 48))?.[cell.index % 48] : items[cell.index];
          return item ? <button type="button" key={item.id} className="cover-thumbnail" data-cover-index={cell.index} disabled={disabled}
            aria-label={`封面 素材 ${cell.index + 1}`}
            aria-pressed={selected.id ? selected.id === item.id : selected.src === item.src}
            style={{ left: cell.start }} onClick={() => onChoose(item)}>
            <Photo src={item.src} sourcePath={item.sourcePath} retryable={false} />
          </button> : <span key={cell.index} className="cover-thumbnail cover-thumbnail-placeholder" aria-hidden="true" style={{ left: cell.start }} />;
        })}
      </div>
    </div>
    {error && <p role="alert">照片读取失败 <Button size="sm" onClick={() => setAttempt(n => n + 1)}>重试</Button></p>}
    {!error && remote && !result.pages.size && <p role="status">正在读取照片…</p>}
    {!error && (!remote || result.pages.size > 0) && !total && <p className="muted">这个写真集还没有图片</p>}
  </div>;
}

export function AlbumCoverEditor({ album, defaultCover, defaultCoverMediaId, defaultCrop, items, albumId, localOnly, disabled, onChange }: {
  album: Album; defaultCover: string; defaultCoverMediaId?: string; defaultCrop?: AvatarCrop; items: MediaItem[]; albumId?: string; localOnly?: boolean;
  disabled: boolean; onChange: (src: string, mediaId: string | undefined, crop: AvatarCrop | undefined) => void;
}) {
  const { page } = useData();
  const { reduced } = useUiMotion();
  const remote = !!page && !!albumId && !localOnly;
  const [adjusted, setAdjusted] = useState(false);
  const crop = coverCrop(album.coverCrop);
  const previewCrop = adjusted ? crop : { ...crop, zoom: 1 };
  const [geometry, setGeometry] = useState({ source: '', ratio: 1 });
  const [coverRatio, setCoverRatio] = useState(3.3);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const visible = !disabled && (hovered || keyboardFocus);
  const selected = { src: album.cover, id: album.coverMediaId || items.find(item => item.src === album.cover)?.id || '' };
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; crop: AvatarCrop; overflowX: number; overflowY: number } | undefined>(undefined);
  const context = useRef({ album, crop, disabled, onChange });
  context.current = { album, crop, disabled, onChange };
  useEffect(() => {
    // The banner is responsive (and can grow for long titles), so use its actual
    // viewport rather than assuming a fixed landscape ratio in the editor.
    const cover = document.querySelector<HTMLElement>('.album-hero-cover-panel');
    if (!cover) return;
    const measure = () => {
      const box = cover.getBoundingClientRect();
      if (box.width && box.height) setCoverRatio(box.width / box.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cover);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      const current = context.current;
      if (current.disabled || !current.album.cover || !event.deltaY) return;
      setAdjusted(true);
      event.preventDefault(); drag.current = undefined;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const previous = current.crop;
      const next = { ...previous, zoom: clamp(+(previous.zoom * Math.exp(-clamp(delta, -120, 120) * .001)).toFixed(2), 1, 3) };
      current.album = { ...current.album, coverCrop: next };
      current.crop = next;
      current.onChange(current.album.cover, current.album.coverMediaId, next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => { drag.current = undefined; setAdjusted(false); }, [album.cover]);
  useEffect(() => { if (disabled) drag.current = undefined; }, [disabled]);
  const updateCrop = (next: AvatarCrop) => { if (!disabled && album.cover) { setAdjusted(true); onChange(album.cover, album.coverMediaId, next); } };
  const ratio = geometry.source === selected.src ? geometry.ratio : 1;
  const windowWidth = Math.min(1, coverRatio / ratio) / (adjusted ? 1 : crop.zoom);
  const windowHeight = Math.min(1, ratio / coverRatio) / (adjusted ? 1 : crop.zoom);
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    const image = stage.current?.querySelector('img');
    if (disabled || !image?.naturalWidth || event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    event.preventDefault();
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, crop,
      overflowX: box.width * (1 - windowWidth), overflowY: box.height * (1 - windowHeight) };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (disabled || !start || event.pointerId !== start.pointer) return;
    updateCrop({ ...start.crop,
      x: start.overflowX > .5 ? clamp(start.crop.x + (event.clientX - start.x) / start.overflowX * 100, 0, 100) : start.crop.x,
      y: start.overflowY > .5 ? clamp(start.crop.y + (event.clientY - start.y) / start.overflowY * 100, 0, 100) : start.crop.y });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, Partial<AvatarCrop>> = { ArrowLeft: { x: clamp(crop.x - 2, 0, 100) }, ArrowRight: { x: clamp(crop.x + 2, 0, 100) }, ArrowUp: { y: clamp(crop.y - 2, 0, 100) }, ArrowDown: { y: clamp(crop.y + 2, 0, 100) }, '+': { zoom: clamp(crop.zoom + .1, 1, 3) }, '=': { zoom: clamp(crop.zoom + .1, 1, 3) }, '-': { zoom: clamp(crop.zoom - .1, 1, 3) } };
    if (!disabled && selected.src && moves[event.key]) { event.preventDefault(); updateCrop({ ...crop, ...moves[event.key] }); }
  };
  return <aside className="album-cover-panel" aria-label="封面区">
    <div className="album-section-heading"><div className="album-cover-heading"><h3>封面</h3>
      {!selected.src && <p className="album-cover-description">选择一张照片作为封面</p>}
    </div>
      <Button variant="ghost" className="cover-reset" icon={<RotateCcw />} aria-label="恢复默认封面" hint="恢复默认封面" disabled={disabled || !defaultCover}
        onClick={() => { drag.current = undefined; setAdjusted(false); onChange(defaultCover, defaultCoverMediaId || items.find(item => item.src === defaultCover)?.id, defaultCrop); }} />
    </div>
    <div className="cover-stage" data-has-image={!!selected.src} data-reduced-motion={reduced}
      onPointerMove={event => {
        if (drag.current || event.pointerType === 'touch') return;
        const box = event.currentTarget.getBoundingClientRect();
        setHovered(event.clientY >= box.top + box.height / 2);
      }} onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={event => { setKeyboardFocus(false); if (event.pointerType === 'touch') setHovered(true); }}>
      <div ref={stage} className="cover-crop-stage" role="group" aria-label="封面取景区域" tabIndex={!disabled && selected.src ? 0 : -1}
        style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, aspectRatio: ratio }}
        aria-disabled={disabled}
        onPointerDown={beginDrag} onPointerMove={moveDrag} onKeyDown={keyboard}
        onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
        {selected.src ? <Photo src={selected.src} sourcePath={items.find(item => item.src === selected.src)?.sourcePath} alt="当前写真封面" style={avatarImageStyle(previewCrop)} highResolution resolutionZoom={previewCrop.zoom}
          onReady={ready => { const image = stage.current?.querySelector('img'); if (ready && image?.naturalWidth && image.naturalHeight) setGeometry(previous => previous.source === selected.src && previous.ratio === image.naturalWidth / image.naturalHeight ? previous : { source: selected.src, ratio: image.naturalWidth / image.naturalHeight }); }} /> : <div className="cover-empty"><ImageIcon aria-hidden="true" /></div>}
        {selected.src && geometry.source === selected.src && <span className="cover-crop-window" aria-hidden="true"
          style={{ width: `${windowWidth * 100}%`, height: `${windowHeight * 100}%`,
            left: `${(1 - windowWidth) * crop.x}%`, top: `${(1 - windowHeight) * crop.y}%` }}>
          <span className="cover-crop-grid" />
        </span>}
      </div>
    {(items.length > 0 || remote) && <div className="cover-filmstrip-zone" role="group" aria-label="显示封面缩略图" tabIndex={disabled ? -1 : 0}
      onFocusCapture={event => { if (event.target.matches(':focus-visible')) setKeyboardFocus(true); }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setKeyboardFocus(false); }}
      onKeyDownCapture={() => setKeyboardFocus(true)}>
      <CoverFilmstrip key={`${remote ? albumId : items[0]?.id}:${remote}`} items={items} remote={remote} albumId={albumId} selected={selected} disabled={disabled} visible={visible} onChoose={item => {
      if (disabled) return;
      drag.current = undefined; onChange(item.src, item.id, coverCrop());
    }} /></div>}
    </div>
  </aside>;
}
