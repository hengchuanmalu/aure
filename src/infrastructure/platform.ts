import { websiteUrl } from "@/domain/social-links";

export async function openWebsite(input: string) {
  const url = websiteUrl(input);
  if (!url) throw new Error("无效的网站链接");
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function isFullscreen(): Promise<boolean> {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().isFullscreen();
  }
  return !!document.fullscreenElement;
}
export async function setFullscreen(
  value: boolean,
  element: HTMLElement = document.documentElement,
) {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(value);
    return;
  }
  if (value && !document.fullscreenElement) await element.requestFullscreen();
  else if (!value && document.fullscreenElement)
    await document.exitFullscreen();
}
