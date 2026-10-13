import {
  importBatchEntries,
  type PreparedBatchImport,
} from "@/application/batch-album-import";
import type { Album } from "@/domain/types";
import type { PreparedAlbumImport } from "@/application/album-import";

/** One user selection authorizes import; each album remains an independent transaction. */
export async function importAutomatically(
  batch: PreparedBatchImport,
  save: (pending: PreparedAlbumImport, album: Album) => Promise<unknown>,
) {
  await importBatchEntries(batch.entries, save, (entry, patch) =>
    Object.assign(entry, patch),
  );
  const imported = batch.entries.filter((entry) => entry.status === "imported");
  const duplicates = batch.entries.filter(
    (entry) => entry.status === "duplicate",
  );
  const failures = [
    ...batch.issues.map((issue) => `${issue.name}：${issue.message}`),
    ...batch.entries
      .filter((entry) => entry.status === "error")
      .map((entry) => `${entry.folder.name}：${entry.message}`),
  ];
  return {
    imported: imported.length,
    duplicates: duplicates.length,
    failures,
    retryable: batch.entries.some(
      (entry) => entry.status === "error" && entry.pending,
    ),
    albumId:
      batch.entries.length === 1
        ? (imported[0] || duplicates[0])?.album?.id
        : undefined,
  };
}
