import { type MediaItem } from "@/domain/types";
import { desktop, native } from "@/infrastructure/tauri-bridge";

export type VideoPreparation = {
  requestId: string;
  phase: "probe" | "queued" | "convert";
  percent: number;
};
export type PlaybackSource = {
  src: string;
  compatible: boolean;
  cached?: boolean;
  preview?: boolean;
  canConvert?: boolean;
  duration?: number;
  details?: { codec: string; width: number; height: number };
};
export function prepareVideo(
  item: MediaItem,
  requestId: string,
  force = false,
  preview = false,
): Promise<PlaybackSource> {
  if (!desktop() || !item.sourcePath)
    return Promise.resolve({ src: item.src, compatible: false });
  return native<PlaybackSource>("prepare_video", {
    id: item.id,
    requestId,
    force,
    preview,
  }).then(source => ({...source, canConvert: true})).catch((e) => {
    if (!force && String(e).includes("未找到 FFmpeg / ffprobe"))
      return { src: item.src, compatible: false };
    throw e;
  });
}
export function cancelVideo(requestId: string) {
  if (desktop()) void native("cancel_video", { requestId }).catch(() => {});
}
export async function watchVideoPreparation(
  callback: (progress: VideoPreparation) => void,
) {
  if (!desktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VideoPreparation>("video-preparation", (e) =>
    callback(e.payload),
  );
}
