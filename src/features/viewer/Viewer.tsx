import { useImageViewport } from "@/features/viewer/useImageViewport";
import { useViewerPlayback } from "@/features/viewer/useViewerPlayback";
import { ViewerMedia } from "@/features/viewer/ViewerMedia";
import { Empty } from "@/ui/Empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { albumMedia, catalog } from "@/domain/catalog";
import { isFullscreen, setFullscreen } from "@/infrastructure/platform";
import { useData } from "@/state/data-context";
import { stopPreviews } from "@/state/video-preview";
import { readMediaMetadata } from "@/infrastructure/catalog-maintenance";
import type { MediaItem } from "@/domain/types";
import { MediaRelink } from "@/ui/MediaRelink";
import { recalledSequence, rememberSequence } from "@/state/viewer-sequence";
import { Button } from "@/ui/ActionButton";
import { HoverHint } from "@/ui/HoverHint";
import { TagPicker } from "@/ui/TagPicker";
import { ViewerFilmstrip } from "@/ui/ViewerFilmstrip";
import {
  ArrowLeft,
  BookImage,
  ChevronLeft,
  ChevronRight,
  Heart,
  Info,
  Maximize,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Star,
  ThumbsUp,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
let sessionVolume = 0.5;
export function Viewer() {
  const { albumId, mediaId } = useParams(),
    { db, page, mutate, act, notice, recordRecent } = useData();
  const nav = useNavigate(),
    loc = useLocation();
  const a = catalog(db).albums.get(albumId || "");
  const from =
    loc.state?.from ||
    (a
      ? `/album/${a.id}`
      : albumId === "favorites"
        ? "/favorites?tab=media"
        : albumId?.startsWith("profile-")
          ? `/models/${albumId.slice(8)}`
          : "/library");
  const [sequence] = useState<readonly string[]>(() => {
    if (page) return [];
    const cached =
      recalledSequence(loc.state?.sequenceKey) || loc.state?.sequence;
    if (cached) return cached;
    // After a WebView reload, reconstruct the source filter instead of widening the sequence.
    if (a) {
      const kind = new URLSearchParams(from.split("?")[1]).get("type") || "all";
      return albumMedia(a, db)
        .filter((item) => kind === "all" || item.kind === kind)
        .map((item) => item.id);
    }
    return albumId === "favorites"
      ? db.media.filter((m) => m.favorite).map((m) => m.id)
      : catalog(db).models.get((albumId || "").replace(/^profile-/, ""))
          ?.photoIds || [];
  });
  const [sequenceKey] = useState(() =>
    recalledSequence(loc.state?.sequenceKey)
      ? loc.state.sequenceKey
      : rememberSequence(sequence),
  );
  const resolvedItem = catalog(db).media.byId.get(mediaId || "");
  const previousItem = useRef(resolvedItem);
  const pendingItem = !!page?.viewerMediaId && page.viewerMediaId !== mediaId;
  // Native viewer snapshots hold one media item. Keep the shell and filmstrip
  // while an uncached thumbnail target's metadata arrives, without widening it.
  const item = resolvedItem || (pendingItem ? previousItem.current : undefined);
  useLayoutEffect(() => {
    if (resolvedItem) previousItem.current = resolvedItem;
  }, [resolvedItem]);
  const [savingCover, setSavingCover] = useState(false);
  const [metadata, setMetadata] = useState<{
    id: string;
    data?: Partial<MediaItem>;
    error?: string;
  }>();
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [mediaVisual, setMediaVisual] = useState<{
    id: string;
    state: "ready" | "error";
  }>({ id: "", state: "ready" });
  const coverSavePending = useRef(false);
  const positions = useMemo(
    () => new Map(sequence.map((id, i) => [id, i])),
    [sequence],
  );
  const index = page?.viewer?.index ?? positions.get(mediaId || "") ?? -1;
  const sequenceLength = page?.viewer?.total ?? sequence.length;
  const [visible, setVisible] = useState(true),
    [fullscreen, setFullscreenState] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [info, setInfo] = useState(false),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(true),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(sessionVolume);
  const video = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    focus = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!info || !item?.sourcePath || !page || pendingItem) return;
    let alive = true;
    setMetadata({ id: item.id });
    void readMediaMetadata(item.id, metadataAttempt > 0).then(
      (data) => {
        if (alive) setMetadata({ id: item.id, data });
      },
      (reason) => {
        if (alive) setMetadata({ id: item.id, error: String(reason) });
      },
    );
    return () => {
      alive = false;
    };
  }, [info, item?.id, item?.sourcePath, pendingItem, !!page, metadataAttempt]);
  const viewport = useImageViewport(item?.id);
  const {
    zoom,
    setZoom,
    pan,
    setPan,
    nativeSize,
    setNativeSize,
    stage,
    image,
    drag,
    dragging,
    setDragging,
    fit,
    actual,
  } = viewport;
  const { playback, preparing, preparation, videoAttempt, setVideoAttempt } =
    useViewerPlayback(item, video, setError, setPaused);
  const wake = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!focus.current && !drag.current) setVisible(false);
    }, 2000);
  }, []);
  const toggleFull = async () => {
    try {
      const next = !(await isFullscreen());
      await setFullscreen(next, root.current || document.documentElement);
      setFullscreenState(next);
      wake();
    } catch {
      setError("无法切换全屏，请重试");
    }
  };
  useLayoutEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const hasMedia = !!item;
  useLayoutEffect(() => {
    // A direct native route can mount before its media/root exists. Focus once
    // that root arrives; moving between media must not steal thumbnail focus.
    if (hasMedia)
      root.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [hasMedia]);
  const exit = async () => {
    try {
      await setFullscreen(false);
    } catch {
      notice("窗口状态恢复失败，请手动退出全屏");
    } finally {
      if (loc.state?.backgroundLocation) nav(-1);
      else nav(from);
    }
  };
  const choose = (id: string) => {
    if (id === mediaId) return;
    video.current?.pause();
    nav(`/viewer/${albumId}/${id}`, {
      replace: true,
      state: { ...loc.state, from, sequenceKey },
    });
  };
  const change = (step: number) => {
    const next = page?.viewer
      ? step < 0
        ? page.viewer.previous
        : page.viewer.next
      : sequence[index + step];
    if (next) {
      choose(next);
    }
  };
  const play = () => {
    const v = video.current;
    if (v) {
      if (v.paused)
        v.play().catch(() => setError("播放失败，请重试或切换媒体"));
      else v.pause();
    }
  };
  useEffect(() => {
    let alive = true;
    const sync = () => {
      void isFullscreen().then((value) => {
        if (alive) setFullscreenState(value);
      }, () => {});
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("resize", sync);
    return () => {
      alive = false;
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  useEffect(() => {
    generation.current++;
    stopPreviews();
    fit();
    setError("");
    setTime(0);
    setDuration(0);
    setNativeSize({ width: 0, height: 0 });
    setVideoAttempt(0);
    wake();
    const v = video.current;
    if (v) {
      v.volume = sessionVolume;
      setPaused(true);
    }
    return () => {
      generation.current++;
      clearTimeout(timer.current);
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, [mediaId, item?.id]);
  useEffect(() => {
    // Album metadata can arrive after an already cached image. Keep history
    // separate from playback/viewport resets and wait for the requested item.
    if (a && mediaId && item?.id === mediaId)
      void recordRecent({ albumId: a.id, mediaId, at: new Date().toISOString() });
  }, [a?.id, mediaId, item?.id]);
  useEffect(() => {
    const key = async (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // A portalled confirmation owns its keys. The viewer itself may also be
      // a dialog, so only an additional dialog suspends its shortcuts.
      const dialog = target.closest('[role="dialog"],[role="alertdialog"]');
      if (dialog && dialog !== root.current) return;
      if (menuOpen || (e.defaultPrevented && !(e.key === "Escape" && info)))
        return;
      if (
        target.matches(
          "input,textarea,select,[contenteditable=true]",
        ) || (target.closest(".info-panel") && e.key !== "Escape")
      )
        return;
      wake();
      if (e.key === "Escape") {
        if (info) setInfo(false);
        else {
          try {
            if (await isFullscreen()) {
              await setFullscreen(false);
              setFullscreenState(false);
            } else await exit();
          } catch {
            setError("无法退出全屏，请重试或返回详情");
          }
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const sign = e.key === "ArrowRight" ? 1 : -1;
        if (item?.kind === "video" && !e.altKey && video.current)
          video.current.currentTime = Math.max(
            0,
            Math.min(
              video.current.duration || 0,
              video.current.currentTime + sign * 5,
            ),
          );
        else change(sign);
      }
      if (e.key === " " && item?.kind === "video") {
        e.preventDefault();
        play();
      }
      if (e.key.toLowerCase() === "f") void toggleFull();
      if (e.key.toLowerCase() === "i") setInfo((v) => !v);
      if (item?.kind === "image") {
        if (e.key === "+" || e.key === "=")
          setZoom((v) => Math.min(8, v * 1.25));
        if (e.key === "-") setZoom((v) => Math.max(0.25, v / 1.25));
        if (e.key === "0") fit();
        if (e.key === "1") actual();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!item)
    return page?.refreshing ? (
      <div className="loading" role="status">正在读取媒体…</div>
    ) : (
      <Empty title="媒体不存在">
        <Button onClick={() => void exit()}>返回</Button>
      </Empty>
    );
  const show =
    !fullscreen ||
    visible ||
    info ||
    menuOpen ||
    dragging ||
    !!error ||
    preparing;
  const isCover =
    !!a && (a.coverMediaId ? a.coverMediaId === item.id : a.cover === item.src);
  const setCover = async () => {
    if (
      pendingItem ||
      !a ||
      item.kind !== "image" ||
      index < 0 ||
      isCover ||
      coverSavePending.current
    )
      return;
    coverSavePending.current = true;
    setSavingCover(true);
    try {
      await act({ type: "setAlbumCover", albumId: a.id, mediaId: item.id });
      notice("已设为写真集封面");
    } catch {
      notice("设置封面失败，请重试");
    } finally {
      coverSavePending.current = false;
      setSavingCover(false);
    }
  };
  const edit = (change: Partial<MediaItem> | ((current: MediaItem) => Partial<MediaItem>)) => {
    if (pendingItem) return;
    void mutate((d) => {
      const current = d.media.find((m) => m.id === item.id);
      if (!current) throw Error("媒体已不存在");
      Object.assign(current, typeof change === 'function' ? change(current) : change);
    }).catch(() => notice("媒体修改保存失败，请重试"));
  };
  const details =
    metadata?.id === item.id && metadata.data
      ? { ...item, ...metadata.data }
      : item;
  return (
    <div
      ref={root}
      aria-busy={pendingItem}
      className={`viewer ${show ? "controls-visible" : ""} ${fullscreen ? "viewer-fullscreen" : ""} ${item.kind === "video" ? "viewer-video" : ""}`}
      onPointerMove={wake}
      onFocusCapture={() => {
        focus.current = true;
        wake();
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          focus.current = false;
          wake();
        }
      }}
    >
      <div
        ref={stage}
        className="media-stage"
        data-media-state={
          mediaVisual.id === item.id ? mediaVisual.state : "loading"
        }
        onPointerDown={(e) => {
          if (item.kind === "image" && zoom > 1) {
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = undefined;
          setDragging(false);
          wake();
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          setDragging(false);
        }}
        onWheel={(e) => {
          if (item.kind === "image") {
            setZoom((z) =>
              Math.max(0.25, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))),
            );
            wake();
          }
        }}
      >
        <ViewerMedia
          item={item}
          viewport={viewport}
          video={video}
          mediaVisual={mediaVisual}
          setMediaVisual={setMediaVisual}
          playback={playback}
          preparing={preparing}
          videoAttempt={videoAttempt}
          setVideoAttempt={setVideoAttempt}
          setError={setError}
          setPaused={setPaused}
          setDuration={setDuration}
          setTime={setTime}
          sessionVolume={sessionVolume}
          play={play}
          wake={wake}
        />
      </div>
      {preparing && (
        <div className="viewer-preparation" role="status" aria-live="polite">
          <strong>
            {preparation?.phase === "convert"
              ? `正在准备兼容播放副本 ${Math.floor(preparation.percent)}%`
              : preparation?.phase === "queued"
                ? "等待准备视频…"
                : "正在检查视频…"}
          </strong>
          <p>首次准备可能需要一些时间，完成后可重复播放。原视频保持不变。</p>
          {preparation?.phase === "convert" && (
            <progress max={100} value={preparation.percent} />
          )}
          <Button onClick={() => void exit()}>返回详情</Button>
        </div>
      )}
      <div className="viewer-controls" inert={!show}>
        <header className="viewer-top">
          <div className="viewer-heading">
            <Button
              variant="ghost"
              aria-label="返回详情"
              icon={<ArrowLeft />}
              onClick={() => void exit()}
            />
            <HoverHint text={a?.name || "照片与视频"}>
              <strong>{a?.name || "照片与视频"}</strong>
            </HoverHint>
            <span className="viewer-position" aria-live="polite">
              {index + 1} / {sequenceLength}
            </span>
          </div>
          <div className="viewer-actions">
            {a && item.kind === "image" && index >= 0 && (
              <Button
                variant="ghost"
                className="viewer-cover-action"
                aria-label="设为封面"
                title={
                  savingCover
                    ? "正在保存封面…"
                    : isCover
                      ? "当前封面"
                      : "设为封面"
                }
                aria-pressed={isCover}
                aria-busy={savingCover}
                disabled={pendingItem || savingCover || isCover}
                icon={<BookImage />}
                onClick={() => void setCover()}
              />
            )}
            <Button
              variant="ghost"
              className={item.favorite ? "viewer-favorited" : ""}
              aria-label={item.favorite ? "取消收藏照片" : "收藏照片"}
              aria-pressed={item.favorite}
              disabled={pendingItem}
              icon={item.favorite ? <Heart fill="currentColor" /> : <Heart />}
              onClick={() => edit(current => ({ favorite: !current.favorite }))}
            />
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="更多操作"
                  icon={<MoreHorizontal />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="viewer-menu">
                <DropdownMenuItem
                  disabled={pendingItem}
                  onSelect={() => edit(current => ({ liked: !current.liked }))}
                >
                  <ThumbsUp />
                  {item.liked ? "取消喜欢" : "喜欢"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setInfo(true)}>
                  <Info />
                  媒体信息
                </DropdownMenuItem>
                {item.kind === "image" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={fit}>
                      <ZoomOut />
                      适应窗口
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={actual}>
                      <ZoomIn />
                      实际大小
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              aria-label="全屏"
              aria-pressed={fullscreen}
              icon={<Maximize />}
              onClick={() => void toggleFull()}
            />
          </div>
        </header>
        <Button
          className="viewer-prev"
          aria-label="上一项"
          disabled={index <= 0}
          icon={<ChevronLeft />}
          onClick={() => change(-1)}
        />
        <Button
          className="viewer-next"
          aria-label="下一项"
          disabled={index >= sequenceLength - 1}
          icon={<ChevronRight />}
          onClick={() => change(1)}
        />
        {item.kind === "video" ? (
          <div className="video-controls">
            <Button
              variant="default"
              icon={
                paused ? (
                  time >= duration && duration > 0 ? (
                    <RotateCcw />
                  ) : (
                    <Play />
                  )
                ) : (
                  <Pause />
                )
              }
              onClick={play}
              disabled={preparing || !playback}
            >
              {paused
                ? time >= duration && duration > 0
                  ? "重播"
                  : "播放"
                : "暂停"}
            </Button>
            <span>
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <input
              type="range"
              aria-label="播放进度"
              disabled={preparing || !duration}
              min="0"
              max={duration || 1}
              step=".01"
              value={time}
              onChange={(e) => {
                if (video.current) video.current.currentTime = +e.target.value;
                setTime(+e.target.value);
              }}
            />
            <Button
              variant="ghost"
              icon={volume === 0 ? <VolumeX /> : <Volume2 />}
              onClick={() => {
                const n = volume === 0 ? 0.5 : 0;
                setVolume(n);
                sessionVolume = n;
                if (video.current) video.current.volume = n;
              }}
            >
              {volume === 0 ? "取消静音" : "静音"}
            </Button>
            <input
              className="volume"
              type="range"
              aria-label="音量"
              min="0"
              max="1"
              step=".01"
              value={volume}
              onChange={(e) => {
                const n = +e.target.value;
                setVolume(n);
                sessionVolume = n;
                if (video.current) video.current.volume = n;
              }}
            />
          </div>
        ) : (
          <div
            className="viewer-image-tools"
            role="group"
            aria-label="图片缩放"
          >
            <Button
              variant="ghost"
              aria-label="缩小"
              icon={<ZoomOut />}
              onClick={() => setZoom((v) => Math.max(0.25, v / 1.25))}
            />
            <Button variant="ghost" onClick={fit} title="适应窗口 · 0">
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              aria-label="放大"
              icon={<ZoomIn />}
              onClick={() => setZoom((v) => Math.min(8, v * 1.25))}
            />
          </div>
        )}
      </div>
      <ViewerFilmstrip
        key={`${albumId}:${new URLSearchParams(from.split("?")[1]).get("type") || "all"}:${albumId === "favorites" ? item.favorite : ""}`}
        sequence={sequence}
        total={sequenceLength}
        selectedIndex={index}
        remote={!!page}
        current={item}
        onChoose={choose}
        query={
          albumId === "favorites"
            ? { favorite: true }
            : albumId?.startsWith("profile-")
              ? { profile: albumId.slice(8) }
              : {
                  album: albumId,
                  kind:
                    new URLSearchParams(from.split("?")[1]).get("type") ||
                    "all",
                }
        }
      />
      {error && (
        <div className="viewer-error" role="alert">
          <h2>暂时无法打开</h2>
          <p>{error}</p>
          <Button
            onClick={() => {
              setError("");
              if (video.current) {
                setVideoAttempt((n) => n + 1);
              }
              // Preserve the revision query after a relink or folder refresh.
              // Retrying the stable URL could otherwise reuse the old original.
              const imageSource = image.current?.getAttribute("src");
              if (image.current && imageSource) image.current.src = imageSource;
            }}
          >
            重试
          </Button>
          <Button onClick={() => void exit()}>返回详情</Button>
        </div>
      )}
      {info && (
        <aside className="info-panel">
          <div className="section-title">
            <h2>{item.kind === "image" ? "照片信息" : "视频信息"}</h2>
            <Button
              variant="ghost"
              aria-label="关闭信息"
              icon={<X />}
              onClick={() => setInfo(false)}
            />
          </div>
          <h3>{item.name}</h3>
          <p className="muted">{item.sourcePath ? "本地媒体" : "演示素材"}</p>
          {item.sourcePath && <MediaRelink key={item.id} id={item.id} />}
          <div className="rating" aria-label="星级评分">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                variant="ghost"
                className={item.rating >= n ? "rated" : ""}
                aria-label={`${n} 星`}
                disabled={pendingItem}
                aria-pressed={item.rating === n}
                onClick={() => edit(current => ({ rating: current.rating === n ? 0 : n }))}
                icon={<Star />}
              />
            ))}
          </div>
          <h3>标签</h3>
          <TagPicker value={item.tags} onChange={(tags) => edit({ tags })}
            onToggle={id => edit(current => ({ tags: current.tags.includes(id)
              ? current.tags.filter(tag => tag !== id) : [...current.tags, id] }))} />
          <h3>{item.kind === "image" ? "EXIF 与文件信息" : "媒体元数据"}</h3>
          {metadata?.id === item.id && metadata.error && (
            <p className="error" role="alert">
              媒体信息读取失败{" "}
              <Button onClick={() => setMetadataAttempt((n) => n + 1)}>
                重试
              </Button>
            </p>
          )}
          <dl className="metadata">
            <div>
              <dt>分辨率</dt>
              <dd>
                {nativeSize.width || details.width || "未知"} ×{" "}
                {nativeSize.height || details.height || "未知"}
              </dd>
            </div>
            <div>
              <dt>文件大小</dt>
              <dd>
                {item.size
                  ? `${(item.size / 1024 / 1024).toFixed(2)} MB`
                  : "未读取"}
              </dd>
            </div>
            {item.kind === "video" ? (
              <>
                <div>
                  <dt>时长</dt>
                  <dd>{formatTime(duration || details.duration || 0)}</dd>
                </div>
                <div>
                  <dt>编码</dt>
                  <dd>
                    {playback?.details?.codec || details.codec || "未读取"}
                    {playback?.compatible ? " · 兼容播放副本" : ""}
                  </dd>
                </div>
              </>
            ) : details.exif && Object.keys(details.exif).length ? (
              Object.entries(details.exif).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))
            ) : (
              <p className="muted">
                这张图片没有可用的 EXIF。拍摄时间、相机、镜头、焦距、光圈和 ISO
                未知。
              </p>
            )}
          </dl>
        </aside>
      )}
    </div>
  );
}
function formatTime(t: number) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}
