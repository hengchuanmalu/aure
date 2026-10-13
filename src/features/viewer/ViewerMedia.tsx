import type { Dispatch, SetStateAction, RefObject } from "react";
import type { MediaItem } from "@/domain/types";
import type { PlaybackSource } from "@/infrastructure/video-playback";
import { Photo } from "@/ui/Photo";
import type { useImageViewport } from "@/features/viewer/useImageViewport";

export type MediaVisual = { id: string; state: "ready" | "error" };
type Props = {
  item: MediaItem;
  viewport: ReturnType<typeof useImageViewport>;
  video: RefObject<HTMLVideoElement | null>;
  mediaVisual: MediaVisual;
  setMediaVisual: Dispatch<SetStateAction<MediaVisual>>;
  playback: (PlaybackSource & { id: string }) | null;
  preparing: boolean;
  videoAttempt: number;
  setVideoAttempt: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setTime: Dispatch<SetStateAction<number>>;
  sessionVolume: number;
  play: () => void;
  wake: () => void;
};
export function ViewerMedia({
  item,
  viewport,
  video,
  mediaVisual,
  setMediaVisual,
  playback,
  preparing,
  videoAttempt,
  setVideoAttempt,
  setError,
  setPaused,
  setDuration,
  setTime,
  sessionVolume,
  play,
  wake,
}: Props) {
  const { image, zoom, pan, setNativeSize } = viewport;
  const revision = item.sourceRevision;
  const imageSrc = revision && item.src.startsWith("http://jingji.localhost/media/")
    ? `${item.src.split("?")[0]}?v=${encodeURIComponent(revision)}`
    : item.src;
  return (
    <>
      {!(mediaVisual.id === item.id && mediaVisual.state === "ready") && (
        <>
          <span className="viewer-media-placeholder" aria-hidden="true" />
          {mediaVisual.id !== item.id &&
            (item.kind === "image" || item.poster) && (
              <Photo
                key={item.id}
                src={item.kind === "image" ? item.src : item.poster!}
                alt=""
                retryable={false}
                className="viewer-loading-cover"
              />
            )}
        </>
      )}
      {item.kind === "image" ? (
        <img
          key={item.id}
          ref={image}
          src={imageSrc}
          alt={item.name}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "default",
          }}
          onLoad={(e) => {
            const element = e.currentTarget;
            setNativeSize({
              width: element.naturalWidth,
              height: element.naturalHeight,
            });
            void element
              .decode()
              .catch(() => {})
              .then(() => {
                if (
                  element === image.current &&
                  element.isConnected &&
                  element.naturalWidth > 0
                ) {
                  element.style.removeProperty("visibility");
                  setError("");
                  setMediaVisual({ id: item.id, state: "ready" });
                }
              });
          }}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
            setMediaVisual({ id: item.id, state: "error" });
            setError("图片无法打开，文件可能缺失。");
          }}
        />
      ) : (
        <video
          key={item.id}
          ref={video}
          src={playback?.id === item.id ? playback.src : undefined}
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            setNativeSize({
              width: e.currentTarget.videoWidth,
              height: e.currentTarget.videoHeight,
            });
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedData={(e) => {
            if (
              e.currentTarget !== video.current ||
              !e.currentTarget.isConnected
            )
              return;
            if (!e.currentTarget.videoWidth && playback?.canConvert && videoAttempt === 0) {
              setVideoAttempt(1);
              return;
            }
            if (e.currentTarget.videoWidth > 0)
              setMediaVisual({ id: item.id, state: "ready" });
            e.currentTarget.volume = sessionVolume;
            if (document.visibilityState === "visible" && document.hasFocus())
              void e.currentTarget.play().catch(() => setPaused(true));
          }}
          onPlay={() => {
            setPaused(false);
            setError("");
          }}
          onPause={() => setPaused(true)}
          onEnded={() => {
            setPaused(true);
            wake();
          }}
          onError={() => {
            if (!playback || preparing) return;
            if (playback.canConvert && !playback.compatible && videoAttempt === 0) setVideoAttempt(1);
            else {
              setMediaVisual({ id: item.id, state: "error" });
              setError("无法播放此视频，请重试或切换媒体。");
            }
          }}
          onClick={() => {
            play();
            wake();
          }}
        />
      )}
    </>
  );
}
