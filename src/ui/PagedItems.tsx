import { readCandidates } from '@/infrastructure/desktop-repository';
import { useData } from '@/state/data-context';
import { Button } from '@/ui/ActionButton';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const WINDOW_SIZE = 48;
type ItemProps<T> = {
  items: readonly T[];
  className: string;
  render: (item: T, index: number) => ReactNode;
  label?: string;
  kind?: 'media' | 'albums' | 'models';
  query?: Record<string, unknown>;
  emptyText?: string;
  children?: ReactNode;
};

/** Read finite windows as the enclosing picker scrolls, retaining earlier choices. */
export function PagedItems<T>(props: ItemProps<T>) {
  const { page } = useData();
  return page && props.kind
    ? <RemoteItems {...props} kind={props.kind} key={`${props.kind}:${JSON.stringify(props.query || {})}`} />
    : <LocalItems {...props} />;
}

function useLoadAtEnd(active: boolean, progress: number, load: () => void) {
  const sentinel = useRef<HTMLDivElement>(null);
  const callback = useRef(load);
  callback.current = load;
  useEffect(() => {
    const element = sentinel.current;
    if (!active || !element) return;
    // Use the nearest scrolling surface, including nested album-editor pickers.
    let root = element.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (!requested && entries.some(entry => entry.isIntersecting)) {
        requested = true;
        callback.current();
      }
    }, { root, rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, progress]);
  return sentinel;
}

function LocalItems<T>({ items, className, render, label = '选择内容', emptyText, children }: ItemProps<T>) {
  const [visible, setVisible] = useState(WINDOW_SIZE);
  const more = visible < items.length;
  const sentinel = useLoadAtEnd(more, visible, () => setVisible(count => count + WINDOW_SIZE));
  return <div role="group" aria-label={label}>
    {!items.length && emptyText && <p className="muted">{emptyText}</p>}
    <div className={className}>{items.slice(0, visible).map(render)}{children}</div>
    {more && <div ref={sentinel} className="continuous-loader" />}
  </div>;
}

function RemoteItems<T>({ kind, query = {}, render, className, label = '选择内容', emptyText, children }: ItemProps<T> & { kind: string }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ items: T[]; total: number; page: number }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const queryKey = JSON.stringify(query);
  const pending = result?.page !== page;
  useEffect(() => {
    let alive = true;
    setError('');
    void readCandidates<T>(kind, page, JSON.parse(queryKey)).then(value => {
      if (alive) setResult(previous => ({
        items: page === 0 ? value.items : [...(previous?.items || []), ...value.items],
        total: value.total,
        page,
      }));
    }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [kind, page, queryKey, attempt]);
  const more = !!result && (result.page + 1) * WINDOW_SIZE < result.total;
  const sentinel = useLoadAtEnd(more && !pending && !error, page, () => setPage(index => index + 1));
  return <div role="group" aria-label={label} aria-busy={pending && !error}>
    {!result && !error && <p role="status">正在读取…</p>}
    {result && !result.total && emptyText && <p className="muted">{emptyText}</p>}
    <div className={className}>{result?.items.map(render)}{children}</div>
    {more && <div ref={sentinel} className="continuous-loader" />}
    {error && <p role="alert">{error} <Button onClick={() => setAttempt(n => n + 1)}>重试</Button></p>}
  </div>;
}
