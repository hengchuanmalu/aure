import { photosFirst } from "@/domain/media-order";
import { type Album, type Database, type MediaItem } from "@/domain/types";

// Snapshots are immutable outside Repository.update. Weak keys release old indexes.
const mediaCache = new WeakMap<MediaItem[], ReturnType<typeof indexMedia>>();
function indexMedia(media: MediaItem[]) {
  const byId = new Map<string, MediaItem>();
  const bySource = new Map<string, MediaItem>();
  const tagCounts = new Map<string, number>();
  for (const item of media) {
    byId.set(item.id, item);
    bySource.set(item.src, item);
    for (const tag of new Set(item.tags))
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  return { byId, bySource, tagCounts };
}
export function mediaIndex(media: MediaItem[]) {
  let index = mediaCache.get(media);
  if (!index) {
    index = indexMedia(media);
    mediaCache.set(media, index);
  }
  return index;
}
export type AlbumSummary = {
  images: number;
  videos: number;
  bytes: number;
  tags: Set<string>;
  searchText: string;
  previews: string[];
};
function buildCatalog(db: Database) {
  const media = mediaIndex(db.media);
  const tags = new Map(db.tags.map((t) => [t.id, t]));
  const models = new Map(db.models.map((m) => [m.id, m]));
  const albums = new Map(db.albums.map((a) => [a.id, a]));
  const summaries = new Map<string, AlbumSummary>();
  const modelCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const album of db.albums) {
    if (album._summary) {
      summaries.set(album.id, {
        ...album._summary,
        tags: new Set(album._summary.tags),
      });
      for (const id of new Set(album.modelIds))
        modelCounts.set(id, (modelCounts.get(id) || 0) + 1);
      for (const id of new Set(album._summary.tags))
        tagCounts.set(id, (tagCounts.get(id) || 0) + 1);
      continue;
    }
    const summary: AlbumSummary = {
      images: 0,
      videos: 0,
      bytes: 0,
      tags: new Set(album.tags),
      searchText: "",
      previews: [],
    };
    for (const id of new Set(album.mediaIds)) {
      const item = media.byId.get(id);
      if (!item) continue;
      item.kind === "image" ? summary.images++ : summary.videos++;
      summary.bytes += item.size;
      for (const tag of item.tags) summary.tags.add(tag);
      const src = item.kind === "image" ? item.src : item.poster;
      if (
        src &&
        src !== album.cover &&
        summary.previews.length < 4 &&
        !summary.previews.includes(src)
      )
        summary.previews.push(src);
    }
    summary.searchText = [
      album.name,
      album.number || "",
      album.subtitle,
      album.description,
      ...[...summary.tags].map((id) => tags.get(id)?.name || ""),
      ...album.modelIds.map((id) => models.get(id)?.name || ""),
    ]
      .join(" ")
      .toLocaleLowerCase();
    summaries.set(album.id, summary);
    for (const id of new Set(album.modelIds))
      modelCounts.set(id, (modelCounts.get(id) || 0) + 1);
    for (const id of summary.tags)
      tagCounts.set(id, (tagCounts.get(id) || 0) + 1);
  }
  return { media, tags, models, albums, summaries, modelCounts, tagCounts };
}
type Catalog = ReturnType<typeof buildCatalog>;
const catalogCache = new WeakMap<
  Album[],
  {
    media: Database["media"];
    models: Database["models"];
    tags: Database["tags"];
    index: Catalog;
  }
>();
export function catalog(db: Database): Catalog {
  const cached = catalogCache.get(db.albums);
  if (
    cached &&
    cached.media === db.media &&
    cached.models === db.models &&
    cached.tags === db.tags
  )
    return cached.index;
  const index = buildCatalog(db);
  catalogCache.set(db.albums, {
    media: db.media,
    models: db.models,
    tags: db.tags,
    index,
  });
  return index;
}
export function albumMedia(album: Album, db: Database) {
  const { byId } = mediaIndex(db.media);
  return photosFirst(
    album.mediaIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    }),
  );
}
export function queryAlbums(
  db: Database,
  query: string,
  tags: string[] = [],
  model = "",
  kind = "all",
) {
  const index = catalog(db);
  const needle = query.trim().toLocaleLowerCase();
  return db.albums.filter((album) => {
    const summary = index.summaries.get(album.id)!;
    return (
      (!needle || summary.searchText.includes(needle)) &&
      tags.every((tag) => summary.tags.has(tag)) &&
      (!model || album.modelIds.includes(model)) &&
      (kind === "all" ||
        (kind === "image"
          ? summary.images > 0
          : kind === "video" && summary.videos > 0))
    );
  });
}

export const searchAlbums = queryAlbums;
