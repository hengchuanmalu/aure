import {
  prepareAlbumImport,
  type PreparedAlbumImport,
} from "@/application/album-import";
import { pathKey, type FolderScan } from "@/domain/importing";
import { type Album, type Database, type ModelProfile } from "@/domain/types";

export type FolderBatchScan = {
  path: string;
  name: string;
  albums: FolderScan[];
  issues: { path: string; name: string; message: string }[];
};
export type BatchImportEntry = {
  folder: FolderScan;
  pending?: PreparedAlbumImport;
  album?: Album;
  models?: ModelProfile[];
  status: "ready" | "imported" | "duplicate" | "error";
  message?: string;
};
export type PreparedBatchImport = {
  path: string;
  name: string;
  entries: BatchImportEntry[];
  issues: FolderBatchScan["issues"];
};

/** Share staged names across the batch, without writing or cloning the media library. */
export function prepareBatchImport(
  scan: FolderBatchScan,
  db: Database,
  sources: Record<string, string>,
): PreparedBatchImport {
  const context = {
    ...db,
    models: [...db.models],
    tags: [...db.tags],
    groups: [...db.groups],
  };
  const entries: BatchImportEntry[] = scan.albums.map((folder) => {
    try {
      const pending = prepareAlbumImport(
        folder,
        context,
        sources,
        crypto.randomUUID(),
      );
      for (const kind of ["models", "tags", "groups"] as const) {
        const known = new Set(context[kind].map((item) => item.id));
        // Arrays have distinct domain types, so preserve each explicitly.
        if (kind === "models")
          context.models.push(
            ...pending.models.filter((item) => !known.has(item.id)),
          );
        if (kind === "tags")
          context.tags.push(
            ...pending.tags.filter((item) => !known.has(item.id)),
          );
        if (kind === "groups")
          context.groups.push(
            ...pending.groups.filter((item) => !known.has(item.id)),
          );
      }
      return {
        folder,
        pending,
        album: structuredClone(pending.album),
        status: "ready",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const album = db.albums.find(
        (a) =>
          a.sourceDirectory &&
          pathKey(a.sourceDirectory) === pathKey(folder.path),
      );
      const models = (folder.manifest?.models || []).flatMap((name) =>
        context.models.filter(
          (m) =>
            m.name.trim().toLocaleLowerCase() ===
            name.trim().toLocaleLowerCase(),
        ),
      );
      return {
        folder,
        album,
        models,
        status: message.includes("该文件夹已导入") ? "duplicate" : "error",
        message,
      };
    }
  });
  // Each editor can choose another model/tag staged by the same batch.
  for (const entry of entries)
    if (entry.pending) {
      entry.pending = {
        ...entry.pending,
        models: context.models,
        tags: context.tags,
        groups: context.groups,
      };
    }
  return { path: scan.path, name: scan.name, entries, issues: scan.issues };
}

export function batchModelGroups(entries: BatchImportEntry[]) {
  const groups = new Map<
    string,
    {
      id: string;
      model?: PreparedAlbumImport["models"][number];
      entries: BatchImportEntry[];
    }
  >();
  for (const entry of entries) {
    const models = entry.pending
      ? entry.album?.modelIds
          .map((id) => entry.pending!.models.find((m) => m.id === id))
          .filter((m) => !!m) || []
      : entry.models || [];
    const identities = models.length
      ? models.map((model) => ({ id: model.id, model }))
      : [{ id: "unassigned", model: undefined }];
    for (const identity of identities) {
      const group = groups.get(identity.id) || { ...identity, entries: [] };
      group.entries.push(entry);
      groups.set(identity.id, group);
    }
  }
  return [...groups.values()];
}

export async function importBatchEntries(
  entries: BatchImportEntry[],
  save: (pending: PreparedAlbumImport, album: Album) => Promise<unknown>,
  result: (entry: BatchImportEntry, patch: Partial<BatchImportEntry>) => void,
) {
  for (const entry of entries) {
    if (
      !entry.pending ||
      !entry.album ||
      !["ready", "error"].includes(entry.status)
    )
      continue;
    try {
      await save(entry.pending, entry.album);
      result(entry, { status: "imported", message: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result(entry, {
        status: message.includes("该文件夹已导入") ? "duplicate" : "error",
        message,
      });
    }
  }
}
