import { type MediaItem } from '@/domain/types';
import { cancelVideo,prepareVideo } from "@/infrastructure/video-playback";
import { useData } from '@/state/data-context';
import { claimPreview,releasePreview } from "@/state/video-preview";
import { Photo } from "@/ui/Photo";
import { useUiMotion } from "@/ui/useUiMotion";
import { Check,LoaderCircle,Play } from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";

export function MediaCard({
  item,
  disabled = false,
  onOpen,
  selected,
  onSelect,
}: {
  item: MediaItem;
  disabled?: boolean;
  onOpen: () => void;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null),
    box = useRef<HTMLDivElement>(null),
    pointer = useRef<{ x: number; y: number } | null>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    previewRequest = useRef<string | undefined>(undefined),
    previewClip = useRef(false),
    generation = useRef(0);
  const [state, setState] = useState("idle");
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(item.duration || 0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const { db } = useData();
  const { reduced } = useUiMotion();
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
  const [thumbnailError, setThumbnailError] = useState(false);
  const unavailable = useCallback(() => setThumbnailError(true), []);
  const stop = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    if (previewRequest.current) cancelVideo(previewRequest.current);
    previewRequest.current = undefined;
    const v = ref.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    setState("idle");
    setElapsed(0);
    releasePreview(stop);
  }, []);
  useEffect(() => {
    if (item.kind !== "video") return;
    const el = box.current!;
    const ob = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) stop();
    });
    ob.observe(el);
    const blur = () => stop();
    const scroll = () => {
      const point = pointer.current;
      if (point && !el.contains(document.elementFromPoint(point.x, point.y)))
        stop();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", blur);
    return () => {
      ob.disconnect();
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", blur);
      stop();
    };
  }, [item.id, item.src, item.kind, disabled, stop]);
  useEffect(() => { setThumbnailError(false); setDuration(item.duration || 0); }, [item.id, item.duration, db.settings.videoPosterPercent]);
  const start = () => {
    if (item.kind !== "video" || disabled) return;
    claimPreview(stop);
    const token = ++generation.current;
    setState("pending");
    timer.current = setTimeout(async () => {
      const v = ref.current;
      if (!v) return;
      // Warm cache/direct playback should not flash a loading indicator.
      const loadingTimer = setTimeout(() => { if (token === generation.current) setState("loading"); }, 180);
      try {
        const requestId = crypto.randomUUID();
        previewRequest.current = requestId;
        const source = await prepareVideo(item, requestId, false, true);
        if (token !== generation.current) return;
        previewClip.current = !!source.preview;
        if (source.duration && source.duration > 0) setDuration(source.duration);
        v.src = source.src;
        await v.play();
        // A later hover may already own this same element; never pause its play.
        if (token !== generation.current) return;
        setState("playing");
      } catch {
        if (token === generation.current) setState("error");
      } finally { clearTimeout(loadingTimer); }
    }, 300);
  };
  return (
    <div
      ref={box}
      className={`media-card ${selected ? "selected" : ""}`}
      data-media-kind={item.kind}
      data-media-id={item.id}
      data-preview={state}
      data-reduced-motion={reduced}
      onMouseEnter={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
        start();
      }}
      onMouseMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onMouseLeave={() => {
        pointer.current = null;
        stop();
      }}
    >
      <button
        className="media-open"
        aria-label={`打开 ${item.name}`}
        onFocus={() => { if (!box.current?.matches(':hover')) start(); }}
        onBlur={stop}
        onClick={() => {
          stop();
          onSelect ? onSelect() : onOpen();
        }}
      >
        <Photo
          key={thumbnailAttempt} onUnavailable={unavailable}
          src={item.kind === 'video' && item.sourcePath ? item.src : item.poster || item.src} sourcePath={item.poster && !item.sourcePath ? undefined : item.sourcePath}
          alt={item.name}
          retryable={false}
        />
        {item.kind === "video" && (
          <>
            <video
              ref={ref}
              muted
              loop
              playsInline
              preload="none"
              className={state === "playing" ? "playing" : ""}
              onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value)) { setPreviewDuration(value); if (!previewClip.current && !item.duration) setDuration(value); } }}
              onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)}
              onWaiting={() => setState(previous => previous === 'playing' ? 'loading' : previous)}
              onPlaying={() => setState('playing')}
              onError={() => { if (ref.current?.getAttribute('src')) setState('error'); }}
            />
            <span className="video-badge">
              {state === 'playing' ? <span className="preview-bars" aria-label="正在预览"><i /><i /><i /></span> : <Play />}
              {duration > 0 ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : '视频'}
            </span>
            {state === 'playing' && previewDuration > 0 && <span className="preview-progress" role="progressbar" aria-label="视频预览进度" aria-valuemin={0} aria-valuemax={previewDuration} aria-valuenow={elapsed}><i style={{ transform: `scaleX(${Math.min(1, elapsed / previewDuration)})` }} /></span>}
            {state === "loading" && (
              <span className="preview-state"><LoaderCircle className="preview-spinner" />载入中</span>
            )}
            {state === "error" && (
              <span className="preview-state">无法预览 · 点击打开视频</span>
            )}
          </>
        )}
        {onSelect && (
          <span className="selection-dot">
            {selected ? <Check aria-hidden="true" /> : null}
          </span>
        )}
      </button>
      {thumbnailError && <button className="thumbnail-retry" aria-label={`重试缩略图 ${item.name}`}
        onClick={() => { setThumbnailError(false); setThumbnailAttempt(n => n + 1); }}>重试</button>}
    </div>
  );
}
