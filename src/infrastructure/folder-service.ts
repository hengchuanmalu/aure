import {
  prepareBatchImport,
  type FolderBatchScan,
} from "@/application/batch-album-import";
import type { FolderScan } from "@/domain/importing";
import { type Database } from "@/domain/types";
import { desktop, native } from "@/infrastructure/tauri-bridge";

export async function folderSources(folder: FolderScan) {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return Object.fromEntries(
    folder.files.map((f) => [f.path, convertFileSrc(f.path)]),
  );
}
export async function selectAlbumImport() {
  if (!desktop())
    throw Error(
      "真实文件夹导入请在 aure 桌面版使用；浏览器预览仅支持已有素材。",
    );
  const folder = await native<FolderScan | FolderBatchScan | null>(
    "select_album_folder",
  );
  if (!folder) return null;
  if ("albums" in folder) {
    const files = folder.albums.flatMap((album) => album.files);
    const [context, sources] = await Promise.all([
      native<Database>("catalog_import_context", {
        paths: files.map((f) => f.path),
        directory: "",
        directories: folder.albums.map((a) => a.path),
      }),
      folderSources({
        path: folder.path,
        name: folder.name,
        files,
        skipped: 0,
      }),
    ]);
    return prepareBatchImport(folder, context, sources);
  }
  const [context, sources] = await Promise.all([
    native<Database>("catalog_import_context", {
      paths: folder.files.map((f) => f.path),
      directory: folder.path,
    }),
    folderSources(folder),
  ]);
  return prepareBatchImport(
    { path: folder.path, name: folder.name, albums: [folder], issues: [] },
    context,
    sources,
  );
}
