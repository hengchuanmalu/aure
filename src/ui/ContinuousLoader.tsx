import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { useEffect,useRef,useState } from 'react';

/** Fetch finite windows automatically as the reader approaches the end. */
export function ContinuousLoader({ media = false }: { media?: boolean }) {
  const { page, loadMore } = useData();
  const sentinel = useRef<HTMLDivElement>(null);
  const fetchNext = useRef(loadMore);
  fetchNext.current = loadMore;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const resume = () => { setError(false); setAttempt(n => n + 1); };
    window.addEventListener('jingji:route', resume);
    return () => window.removeEventListener('jingji:route', resume);
  }, []);
  const total = page ? (media ? page.mediaTotal : page.total) : 0;
  const more = !!page && !page.refreshing && (page.page + 1) * page.limit < total;
  useEffect(() => {
    if (!more || !fetchNext.current || error) return;
    let alive = true;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !document.querySelector('.viewer')) {
        void fetchNext.current!().catch(() => { if (alive) setError(true); });
      }
    }, { rootMargin: '900px' });
    if (sentinel.current) observer.observe(sentinel.current);
    return () => { alive = false; observer.disconnect(); };
  }, [more, page?.page, total, error, attempt]);
  return more ? <div ref={sentinel} className="continuous-loader">
    {error && <p role="alert">后续内容读取失败 <Button onClick={() => { setError(false); setAttempt(n => n + 1); }}>重试</Button></p>}
  </div> : null;
}
