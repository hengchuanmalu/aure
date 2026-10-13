import type { DesktopView } from "@/domain/catalog-view";
import { commitAlbumImport } from "@/application/album-import";
import { markManualImportFields } from "@/domain/import-metadata";
import type { Operation } from "@/application/operations";
import {
  type Album,
  type Database,
  type ModelProfile,
  type RecentView,
} from "@/domain/types";

import { native } from "@/infrastructure/tauri-bridge";
export const readEntity = <T extends Album | ModelProfile>(
  kind: "albums" | "models",
  id: string,
) => native<T | null>("catalog_entity", { kind, id });
export const readCandidates = <T>(
  kind: string,
  page: number,
  query: Record<string, unknown> = {},
) =>
  native<{ items: T[]; total: number }>("catalog_candidates", {
    kind,
    page,
    query,
  });
export async function execute(op: Operation) {
  if (op.type === "saveAlbum")
    op = {
      ...op,
      album: {
        ...markManualImportFields(op.album),
        name: op.album.name.trim(),
        updatedAt: new Date().toISOString().slice(0, 10),
      },
    };
  if (op.type === "saveModel")
    op = { ...op, model: { ...op.model, name: op.model.name.trim() } };
  if (op.type !== "importAlbum")
    return native<void>("catalog_operation", { op });
  const folder = op.pending.folder;
  const scoped = await native<Database>("catalog_import_context", {
    paths: folder.files.map((f) => f.path),
    directory: folder.path,
  });
  const existing = new Set(scoped.models.map((m) => m.id));
  const existingTags = new Set(scoped.tags.map((t) => t.id));
  const existingGroups = new Set(scoped.groups.map((g) => g.id));
  commitAlbumImport(scoped, op.pending, op.album);
  const album = scoped.albums.find((a) => a.id === op.album.id)!;
  await native("catalog_operation", {
    op: {
      type: "importPrepared",
      album,
      media: scoped.media,
      models: scoped.models.filter((m) => !existing.has(m.id)),
      importRules: scoped.importRules || [],
      tags: scoped.tags.filter((t) => !existingTags.has(t.id)),
      groups: scoped.groups.filter((g) => !existingGroups.has(g.id)),
    },
  });
}
/** Compare only the loaded data window. Native commits fields, never a replacement library. */
export function changes(before: Database, after: Database) {
  const patch: Record<string, unknown> = {};
  for (const kind of ["albums", "media", "models", "tags", "groups"] as const) {
    const old = new Map(before[kind].map((v) => [v.id, v]));
    const edits: Record<string, unknown>[] = [];
    for (const value of after[kind]) {
      const previous = old.get(value.id);
      if (!previous) {
        edits.push(value);
        continue;
      }
      const fields: Record<string, unknown> = { id: value.id };
      for (const [key, v] of Object.entries(value)) {
        if (
          JSON.stringify(v) !==
          JSON.stringify((previous as Record<string, unknown>)[key])
        )
          fields[key] = v;
      }
      if (Object.keys(fields).length > 1) edits.push(fields);
    }
    if (edits.length) patch[kind] = edits;
  }
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings))
    patch.settings = after.settings;
  return patch;
}
export const writeRecent = (entry?: RecentView) =>
  native<RecentView[]>("catalog_recent", { entry: entry || null });

export type CatalogQuery = Record<string, unknown>;
export const readView = (query: CatalogQuery) =>
  native<DesktopView>("catalog_view", { query });
export const initializeCatalog = (legacy: string | null) =>
  native<boolean>("catalog_initialize", { legacy });
export const restoreRecent = (entries: RecentView[]) =>
  native<void>("catalog_restore_recent", { entries });
export const patchCatalog = (before: Database, after: Database) =>
  native<void>("catalog_patch", { changes: changes(before, after) });
export const resetCatalog = (seed: Database) =>
  native<void>("catalog_reset", { seed });
export const exportCatalogBackup = () => native<boolean>("catalog_backup");
export const readModelAlbums = (id: string) =>
  native<string[]>("catalog_model_albums", { id });
export const readCoverRevision = (id: string) =>
  native<string>("original_cover_revision", { id });
export async function watchMigration(
  callback: (progress: { phase: string; done: number; total: number }) => void,
) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ phase: string; done: number; total: number }>(
    "catalog-migration-progress",
    (event) => callback(event.payload),
  );
}
