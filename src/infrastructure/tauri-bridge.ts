const bridgeReady = () =>
  typeof (
    window as Window & {
      __TAURI_INTERNALS__?: { invoke?: unknown };
    }
  ).__TAURI_INTERNALS__?.invoke === "function";
export const desktop = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window ||
    window.location.hostname === "tauri.localhost" ||
    window.location.protocol === "tauri:");
export async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // Packaged pages must never select a legacy preview library just because the
  // WebView bridge arrives after the frontend. Wait briefly, then fail visibly.
  if (!bridgeReady()) {
    const deadline = Date.now() + 5000;
    while (!bridgeReady() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!bridgeReady())
      throw Error("桌面接口未就绪，请重试或重新打开应用。正式图库未修改。");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
