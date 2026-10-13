import type { MediaItem } from "@/domain/types";
import { native } from "@/infrastructure/tauri-bridge";
export type RestorePreview = {
  token: string;
  name: string;
  albums: number;
  models: number;
  media: number;
};
export type FolderPreview = {
  token: string;
  albumId: string;
  name: string;
  directory: string;
  added: number;
  moved: number;
  missing: number;
  changed: number;
};
export const prepareRestore = () =>
  native<RestorePreview | null>("prepare_catalog_restore");
export const confirmRestore = (token: string) =>
  native<void>("confirm_catalog_restore", { token });
export const cancelMaintenance = (token: string) =>
  native<void>("cancel_catalog_maintenance", { token });
export const prepareFolderRefresh = (albumId: string, relocate = false) =>
  native<FolderPreview | null>("prepare_folder_refresh", { albumId, relocate });
export const confirmFolderRefresh = (token: string) =>
  native<void>("confirm_folder_refresh", { token });
export const syncFolders = () =>
  native<{ changed: number; issues: number }>("catalog_sync_folders");
export const readMediaMetadata = (id: string, force = false) =>
  native<Partial<MediaItem>>("read_media_metadata", { id, force });
export type MediaRelinkPreview = {
  token: string;
  name: string;
  previousName: string;
  path: string;
};
export const prepareMediaRelink = (id: string) =>
  native<MediaRelinkPreview | null>("prepare_media_relink", { id });
export const confirmMediaRelink = (token: string) =>
  native<void>("confirm_media_relink", { token });
