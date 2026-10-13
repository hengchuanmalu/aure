import {
  useEffect,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MediaItem } from "@/domain/types";
import {
  cancelVideo,
  prepareVideo,
  watchVideoPreparation,
  type PlaybackSource,
  type VideoPreparation,
} from "@/infrastructure/video-playback";

export function useViewerPlayback(
  item: MediaItem | undefined,
  video: RefObject<HTMLVideoElement | null>,
  setError: Dispatch<SetStateAction<string>>,
  setPaused: Dispatch<SetStateAction<boolean>>,
) {
  const [playback, setPlayback] = useState<
    (PlaybackSource & { id: string }) | null
  >(null);
  const [preparing, setPreparing] = useState(false);
  const [preparation, setPreparation] = useState<VideoPreparation | null>(null);
  const [videoAttempt, setVideoAttempt] = useState(0);
  useEffect(() => {
    if (!item || item.kind !== "video") {
      setPlayback(null);
      setPreparing(false);
      return;
    }
    const requestId = crypto.randomUUID();
    let active = true;
    let unlisten = () => {};
    setPlayback(null);
    setPreparing(true);
    setPreparation(null);
    setError("");
    setPaused(true);
    const v = video.current;
    v?.pause();
    void (async () => {
      try {
        unlisten = await watchVideoPreparation((p) => {
          if (active && p.requestId === requestId) setPreparation(p);
        });
        if (!active) {
          unlisten();
          return;
        }
        const source = await prepareVideo(item, requestId, videoAttempt > 0);
        if (!active) return;
        const src = item.sourceRevision && source.src.startsWith("http://jingji.localhost/media/")
          ? `${source.src.split("?")[0]}?v=${encodeURIComponent(item.sourceRevision)}`
          : source.src;
        setPlayback({ ...source, src, id: item.id });
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setPreparing(false);
      }
    })();
    return () => {
      active = false;
      unlisten();
      cancelVideo(requestId);
      v?.pause();
    };
  }, [item?.id, item?.sourcePath, item?.sourceRevision, videoAttempt, video, setError, setPaused]);
  useEffect(() => {
    const onBlur = () => video.current?.pause();
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
    };
  }, []);
  return { playback, preparing, preparation, videoAttempt, setVideoAttempt };
}
