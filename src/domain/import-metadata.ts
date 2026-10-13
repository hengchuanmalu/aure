import type { Album } from "@/domain/types";

/** A later edit owns the field; background rules must never replace it. */
export function markManualImportFields(album: Album): Album {
  if (!album.importMetadata) return album;
  const next = structuredClone(album);
  for (const [field, record] of Object.entries(next.importMetadata!.fields)) {
    const value =
      next[field as keyof NonNullable<Album["importMetadata"]>["fields"]] || "";
    if (JSON.stringify(value) !== JSON.stringify(record.value)) {
      record.source = "manual";
      record.evidence = [];
      record.value = structuredClone(value);
    }
  }
  return next;
}
