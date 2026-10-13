import { mediaIndex } from "@/domain/catalog";
import { type ThumbnailEdge } from '@/domain/types';
import { requestThumbnail } from '@/infrastructure/thumbnail-service';
import { useData } from '@/state/data-context';
import { RetainedOriginalPhoto } from "@/ui/RetainedOriginalPhoto";
import { useBackgroundResolution } from "@/ui/useBackgroundResolution";
import { useEffect,useLayoutEffect,useRef,useState } from 'react';

export function Photo({ src, sourcePath, alt = '', className = '', style, retryable = true, priority = 0, thumbnailEdge = 512, resolutionZoom = 1, highResolution = false, original = false, retainOriginal = false, originalRevision, videoPercent, onUnavailable, onReady }: {
  src: string; sourcePath?: string; alt?: string; className?: string;
  style?: React.CSSProperties; retryable?: boolean; priority?: number; thumbnailEdge?: ThumbnailEdge; resolutionZoom?: number; highResolution?: boolean; original?: boolean; retainOriginal?: boolean; originalRevision?: string; videoPercent?: 10 | 50 | 90; onUnavailable?: () => void; onReady?: (ready: boolean) => void;
}) {
  const { db } = useData();
  const item = mediaIndex(db.media).bySource.get(src);
  let registered: string | undefined;
  try { if (src.startsWith('http://jingji.localhost/media/')) registered = `media:${decodeURIComponent(src.split('/media/')[1])}`; } catch { /* Invalid resource IDs use the retryable placeholder. */ }
  const videoWithoutPoster = item?.kind === 'video' && src === item.src;
  const nativeVideo = videoWithoutPoster && '__TAURI_INTERNALS__' in window;
  const source = nativeVideo ? `video:${encodeURIComponent(item.id)}:${videoPercent ?? db.settings.videoPosterPercent ?? 10}` : sourcePath || registered || item?.sourcePath;
  const local = !!source || /^(asset:|https?:\/\/(asset|jingji)\.localhost)/.test(src);
  const [result, setResult] = useState<{ key: string; identity?: string; url?: string; error?: boolean }>({ key: '' });
  const [attempt, setAttempt] = useState(0);
  const [decodedIdentity, setDecodedIdentity] = useState('');
  const element = useRef<HTMLImageElement>(null);
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const identity = `${src}:${source || ''}:${original}:${originalRevision || ''}:${attempt}`;
  const adaptiveEdge = useBackgroundResolution(element, highResolution && !original && !videoWithoutPoster ? identity : '', resolutionZoom);
  const edge = highResolution && !videoWithoutPoster ? adaptiveEdge : thumbnailEdge;
  const key = `${identity}:${edge}`;
  const error = result.key === key && result.error;
  const renderedSource = local && !original ? (result.identity === identity ? result.url : undefined) : src;
  useLayoutEffect(() => {
    readyCallback.current?.(false);
    const image = element.current;
    if (!image || !renderedSource) return;
    let disposed = false;
    const ready = () => {
      if (image.naturalWidth > 0) void image.decode().catch(() => {}).then(() => {
        if (!disposed && image.naturalWidth > 0) {
          setDecodedIdentity(identity);
          readyCallback.current?.(true);
        }
      });
    };
    image.addEventListener('load', ready);
    if (image.complete) ready();
    return () => { disposed = true; image.removeEventListener('load', ready); };
  }, [renderedSource, identity]);
  useEffect(() => {
    if (error || (videoWithoutPoster && !nativeVideo) || !src) readyCallback.current?.(true);
  }, [error, videoWithoutPoster, nativeVideo, src]);
  useEffect(() => { if (error) onUnavailable?.(); }, [error, onUnavailable]);
  useEffect(() => {
    if (original || !local || (videoWithoutPoster && !nativeVideo)) return;
    const el = element.current;
    if (!el) return;
    let disposed = false;
    let request: ReturnType<typeof requestThumbnail> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (request) return;
        if (!source || !('__TAURI_INTERNALS__' in window)) { setResult({ key, error: true }); return; }
        request = requestThumbnail(source, priority, edge);
        const current = request;
        request.promise.then(url => {
          if (!disposed && request === current) setResult({ key, identity, url });
        }, error => {
          if (!disposed && request === current && error?.name !== 'AbortError') setResult(previous => previous.identity === identity && previous.url ? previous : { key, error: true });
        });
      } else {
        request?.cancel(); request = undefined;

      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => { disposed = true; observer.disconnect(); request?.cancel(); };
  }, [key, identity, source, local, videoWithoutPoster, nativeVideo, priority, original, edge]);
  if (error || (videoWithoutPoster && !nativeVideo) || !src) return <div className={`photo-frame photo-fallback ${className}`} data-photo-state="error">
    <span>{videoWithoutPoster ? '视频封面暂不可用' : '图片暂不可用'}</span>
    {retryable && <button onClick={e => { e.stopPropagation(); setAttempt(n => n + 1); }}>重试</button>}
  </div>;
  if (original && retainOriginal) return <RetainedOriginalPhoto key={key} src={src} revision={originalRevision} alt={alt} className={className} style={style} onReady={onReady} onError={() => setResult({ key, error: true })} />;
  const ready = decodedIdentity === identity;
  return <span className={`photo-frame ${className}`} data-photo-state={ready ? 'ready' : 'loading'}
    role={ready ? undefined : 'img'} aria-label={ready ? undefined : alt || '图片加载中'}>
    <img ref={element} draggable={false} loading={original ? 'eager' : 'lazy'} decoding="async"
    key={identity} src={renderedSource}
    alt={alt} className="photo-image" style={style}
    onError={event => { event.currentTarget.style.visibility = 'hidden'; setResult({ key, error: true }); }} />
  </span>;
}
