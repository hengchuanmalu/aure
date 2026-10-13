import { AlbumCard } from '@/ui/AlbumCard';
import { recommendationSettings } from "@/domain/recommendation-settings";
import { type Album } from '@/domain/types';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { useUiMotion } from "@/ui/useUiMotion";
import { RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect,useRef,useState,type CSSProperties } from 'react';

export function FeaturedRecommendations({ albums, coverRevisions, title }: {
  albums: Album[]; coverRevisions?: Record<string, string>; title: string;
}) {
  const { db } = useData();
  const preferences = recommendationSettings(db.settings);
  const { reduced } = useUiMotion();
  const frame = useRef<HTMLDivElement>(null);
  const ready = useRef(new Set<string>());
  const [readyVersion, setReadyVersion] = useState(0);
  const [offset, setOffset] = useState(0);
  const [request, setRequest] = useState<{ offset: number; manual: boolean } | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden && document.hasFocus());
  const albumsKey = albums.map(album => album.id).join('|');
  useEffect(() => {
    setOffset(0);
    setRequest(null);
    setTransitioning(false);
  }, [albumsKey]);
  const count = Math.min(5, albums.length);
  // Full groups for larger libraries; smaller libraries rotate positions without duplicates.
  const step = albums.length > 5 ? 5 : 1;
  const normalize = (value: number) => (value + albums.length) % albums.length;
  const next = normalize(offset + step);
  const standby = request?.offset ?? next;
  const paused = reduced || !preferences.automatic || (preferences.pauseOnHover && hovered) || focused || menuOpen || !visible || !foreground;
  const group = (start: number) => Array.from({ length: count }, (_, slot) => albums[(start + slot) % albums.length]);
  const coverKey = (start: number, album: Album) => `${start}:${album.id}:${album.cover}:${coverRevisions?.[album.cover] ?? ''}`;

  useEffect(() => {
    // Readiness belongs to mounted images, never to a group visited earlier.
    const mounted = new Set([offset, ...(visible ? [standby] : [])].flatMap(start => group(start).map(album => coverKey(start, album))));
    for (const key of ready.current) if (!mounted.has(key)) ready.current.delete(key);
  }, [offset, standby, visible, albums, coverRevisions]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    const visibility = () => setForeground(!document.hidden && document.hasFocus());
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
    };
  }, []);

  const currentReady = group(offset).every(album => ready.current.has(coverKey(offset, album)));
  const standbyReady = group(standby).every(album => ready.current.has(coverKey(standby, album)));
  useEffect(() => {
    if (albums.length < 2 || paused || request || transitioning || !currentReady) return;
    const timer = window.setTimeout(() => setRequest({ offset: next, manual: false }), preferences.intervalSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [albums.length, paused, request, transitioning, currentReady, offset, next, preferences.intervalSeconds]);

  useEffect(() => {
    if (request && standbyReady && !transitioning && (request.manual || !paused)) setTransitioning(true);
  }, [request, standbyReady, readyVersion, transitioning, paused]);

  function refresh() {
    if (transitioning || request) return;
    setRequest({ offset: next, manual: true });
  }
  function complete() {
    if (!transitioning || !request) return;
    setOffset(request.offset);
    setRequest(null);
    setTransitioning(false);
  }

  // A zero-duration transition need not emit an animation-complete event.
  // Also settle the decoded target when Reduce Motion is enabled mid-flight.
  useEffect(() => {
    if (reduced && transitioning && request) complete();
  }, [reduced, transitioning, request]);

  const starts = albums.length > 1 && visible ? [offset, standby] : [offset];
  return <>
    <div className="section-title">
      <h2>{title}</h2>
      <div className="recommendation-actions">
        <Button variant="ghost" className="recommendation-refresh" aria-label="刷新推荐"
          icon={<RefreshCw />} disabled={albums.length < 2 || transitioning || request !== null} onClick={refresh} />
      </div>
    </div>
    <div ref={frame} className="recommendation-carousel" role="region" aria-roledescription="轮播"
    style={{ '--recommendation-duration': `${preferences.transitionMs}ms` } as CSSProperties}
    aria-label="推荐写真轮换" data-paused={paused} data-transitioning={transitioning}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {starts.map(start => {
      const active = start === offset;
      const entering = !active && transitioning;
      return <motion.div key={start} className={`featured-grid ${count < 3 ? 'few-items' : ''}`}
        data-active={active} data-entering={entering} aria-hidden={!active} inert={!active || transitioning}
        initial={false} animate={{ opacity: active || entering ? 1 : 0 }}
        transition={{ duration: entering && !reduced ? preferences.transitionMs / 1000 : 0, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => { if (entering) complete(); }}>
        {group(start).map(album => <AlbumCard key={album.id} album={album} variant="cover" featured highResolution
          coverRevision={coverRevisions?.[album.cover]} onMenuOpenChange={setMenuOpen}
          onCoverReady={loaded => {
            const key = coverKey(start, album);
            if (loaded !== ready.current.has(key)) {
              if (loaded) ready.current.add(key); else ready.current.delete(key);
              setReadyVersion(version => version + 1);
            }
          }} />)}
      </motion.div>;
    })}
    </div>
  </>;
}
