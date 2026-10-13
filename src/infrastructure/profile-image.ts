import { type MediaItem } from "@/domain/types";
import { desktop, native } from "@/infrastructure/tauri-bridge";

/** Selecting grants preview access; registering the image waits for Save. */
export async function selectProfileImage(
  purpose: "avatar" | "background" = "avatar",
): Promise<MediaItem | null> {
  if (!desktop()) throw Error("从文件管理器选择图片请在 aure 桌面版使用。");
  return native<MediaItem | null>("select_profile_image", { purpose });
}
