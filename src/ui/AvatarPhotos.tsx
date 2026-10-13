import { type MediaItem } from '@/domain/types';
import { readCandidates } from '@/infrastructure/desktop-repository';
import { Button } from "@/ui/ActionButton";
import { HoverHint } from "@/ui/HoverHint";
import { Photo } from "@/ui/Photo";
import { defaultRangeExtractor,useVirtualizer } from '@tanstack/react-virtual';
import { Check } from 'lucide-react';
import { useEffect,useLayoutEffect,useRef,useState } from 'react';

/** Scroll through finite native windows while keeping both the DOM and page cache bounded. */
export function AvatarPhotos({ items, remote, query, selected, disabled, emptyText, onChoose, label = '头像照片', purpose = '头像', aspectRatio = 0.86 }: {
  items: MediaItem[]; remote: boolean; query: Record<string, unknown>; selected: string;
  disabled: boolean; emptyText: string; onChoose: (item: MediaItem) => void;
  label?: string; purpose?: string; aspectRatio?: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 480, columns: 4 });
  const [result, setResult] = useState<{ key: string; total: number; pages: Map<number, MediaItem[]> }>({ key: '', total: 0, pages: new Map() });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const total = remote ? result.total : items.length;
  const rowHeight = (geometry.width - 10 * (geometry.columns - 1)) / geometry.columns / aspectRatio + 10;
  const virtual = useVirtualizer({
    count: Math.ceil(total / geometry.columns), getScrollElement: () => viewport.current,
    estimateSize: () => rowHeight, overscan: 2, useFlushSync: false,
    rangeExtractor: range => {
      const rows = new Set(defaultRangeExtractor(range));
      if (focusedRow !== null && focusedRow < Math.ceil(total / geometry.columns)) rows.add(focusedRow);
      return [...rows].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setGeometry({ width: element.clientWidth,
      columns: Number(getComputedStyle(element).getPropertyValue('--avatar-photo-columns')) || 4 });
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { virtual.measure(); }, [rowHeight, virtual]);
  const rows = virtual.getVirtualItems();
  const required = new Set([0]);
  for (const row of rows) {
    const start = row.index * geometry.columns;
    required.add(Math.floor(start / 48));
    required.add(Math.floor(Math.min(total - 1, start + geometry.columns - 1) / 48));
  }
  // Page zero is needed only for the initial count, then it can leave the cache.
  if (rows.length) required.delete(0);
  for (const row of rows) required.add(Math.floor(row.index * geometry.columns / 48));
  const requiredKey = [...required].filter(index => index >= 0).sort((a, b) => a - b).join(',');
  const queryKey = JSON.stringify(query);
  const pending = remote && result.key !== queryKey;
  useLayoutEffect(() => {
    viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    setFocusedRow(null);
  }, [queryKey]);
  useEffect(() => {
    if (!remote) return;
    let alive = true;
    const indexes = result.key === queryKey ? requiredKey.split(',').map(Number) : [0];
    const missing = indexes.filter(index => result.key !== queryKey || !result.pages.has(index));
    if (!missing.length) return;
    setError('');
    void Promise.all(missing.map(async index => ({ index, result: await readCandidates<MediaItem>('media', index, JSON.parse(queryKey)) }))).then(loaded => {
      if (!alive) return;
      setResult(previous => {
        const pages = previous.key === queryKey ? new Map(previous.pages) : new Map<number, MediaItem[]>();
        for (const item of loaded) pages.set(item.index, item.result.items);
        for (const index of pages.keys()) if (!indexes.some(needed => Math.abs(index - needed) <= 1)) pages.delete(index);
        return { key: queryKey, total: loaded[0].result.total, pages };
      });
    }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [remote, requiredKey, queryKey, attempt, result.key]);
  return <div className="avatar-photo-scroll" ref={viewport} tabIndex={0} role="group" aria-label={label} aria-busy={pending}
    onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-avatar-row]');
      if (row) setFocusedRow(Number(row.dataset.avatarRow));
    }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocusedRow(null); }}>
    {error ? <p role="alert">照片读取失败 <Button onClick={() => setAttempt(value => value + 1)}>重试</Button></p>
      : remote && !result.pages.size ? <p role="status">正在读取…</p> : !total ? <p className="muted">{emptyText}</p> : null}
    <div className="avatar-photo-grid avatar-virtual-grid" style={{ height: virtual.getTotalSize() }}>
      {rows.map(row => <div key={row.index} className="avatar-photo-row" data-avatar-row={row.index}
        style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: Math.min(geometry.columns, total - row.index * geometry.columns) }, (_, column) => {
          const index = row.index * geometry.columns + column;
          const item = remote ? result.pages.get(Math.floor(index / 48))?.[index % 48] : items[index];
          return item ? <HoverHint text={item.name} key={item.id}><button type="button" key={item.id} disabled={disabled || pending} className="avatar-photo"
            style={{ aspectRatio }}
            aria-label={`${purpose} 素材 ${index + 1}`} aria-pressed={selected === item.src} onClick={() => onChoose(item)} >
            <Photo src={item.src} sourcePath={item.sourcePath} retryable={false} /><Check className="avatar-photo-check" aria-hidden="true" />
          </button></HoverHint> : <span key={index} className="avatar-photo-placeholder" aria-hidden="true" />;
        })}
      </div>)}
    </div>
  </div>;
}
