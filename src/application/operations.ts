import {
  commitAlbumImport,
  type PreparedAlbumImport,
} from "@/application/album-import";
import { markManualImportFields } from "@/domain/import-metadata";
import {
  type Album,
  type Database,
  type MediaItem,
  type ModelProfile,
} from "@/domain/types";
export type Operation =
  | { type: "importAlbum"; pending: PreparedAlbumImport; album: Album }
  | { type: "saveAlbum"; album: Album }
  | { type: "setAlbumCover"; albumId: string; mediaId: string }
  | {
      type: "saveModel";
      model: ModelProfile;
      albumIds: string[];
      avatarImage?: MediaItem;
      backgroundImage?: MediaItem;
    }
  | { type: "removeAlbum"; id: string }
  | { type: "addMediaTags"; mediaIds: string[]; tagIds: string[] }
  | {
      type: "addAlbumTags";
      albumIds: string[];
      tagIds: string[];
      includeMedia: boolean;
    }
  | { type: "removeTag"; id: string; group: boolean };
/** Serializable operations share business rules between preview storage and desktop transactions. */
export function applyOperation(d: Database, op: Operation): void {
  switch (op.type) {
    case "importAlbum":
      commitAlbumImport(d, op.pending, op.album);
      break;
    case "saveAlbum": {
      const a = markManualImportFields(structuredClone(op.album));
      a.name = a.name.trim();
      if (!a.name) throw Error("写真集名称不能为空");
      const existingMedia = new Set(d.media.map((m) => m.id));
      if (a.mediaIds.some((id) => !existingMedia.has(id)))
        throw Error("部分媒体已不存在");
      a.updatedAt = new Date().toISOString().slice(0, 10);
      const i = d.albums.findIndex((x) => x.id === a.id);
      if (i < 0) d.albums.unshift(a);
      else d.albums[i] = a;
      break;
    }
    case "setAlbumCover": {
      const album = d.albums.find((item) => item.id === op.albumId);
      const media = d.media.find((item) => item.id === op.mediaId);
      if (!album) throw Error("写真集已不存在");
      if (!media || media.kind !== "image")
        throw Error("请选择一张照片作为封面");
      if (!album.mediaIds.includes(media.id))
        throw Error("所选照片不属于这个写真集");
      album.coverMediaId = media.id;
      album.cover = media.src;
      delete album.coverCrop;
      album.updatedAt = new Date().toISOString().slice(0, 10);
      if (album.importMetadata?.fields.coverMediaId) {
        album.importMetadata.fields.coverMediaId = {
          source: "manual",
          evidence: [],
          value: media.id,
        };
      }
      break;
    }
    case "saveModel": {
      const m = structuredClone(op.model);
      m.name = m.name.trim();
      if (!m.name) throw Error("模特名称不能为空");
      if (m.links.some((l) => l.url && !/^https?:\/\//i.test(l.url)))
        throw Error("社交链接格式不正确");
      const images = [
        [op.avatarImage, m.avatar, "头像"],
        [op.backgroundImage, m.background, "背景"],
      ] as const;
      for (const [image, src, name] of images) {
        if (image && (image.kind !== "image" || image.src !== src))
          throw Error(`${name}图片与草稿不一致`);
      }
      for (const [image] of images)
        if (image && !d.media.some((item) => item.id === image.id))
          d.media.push(structuredClone(image));
      const i = d.models.findIndex((x) => x.id === m.id);
      if (i < 0) d.models.push(m);
      else d.models[i] = m;
      d.albums.forEach((a) => {
        a.modelIds = a.modelIds.filter((id) => id !== m.id);
        if (op.albumIds.includes(a.id)) a.modelIds.push(m.id);
      });
      break;
    }
    case "removeAlbum":
      d.albums = d.albums.filter((a) => a.id !== op.id);
      d.recent = d.recent.filter((r) => r.albumId !== op.id);
      break;
    case "addMediaTags": {
      const tags = op.tagIds.filter((id) => d.tags.some((t) => t.id === id));
      const selectedIds = new Set(op.mediaIds);
      d.media
        .filter((m) => selectedIds.has(m.id))
        .forEach((m) => (m.tags = [...new Set([...m.tags, ...tags])]));
      break;
    }
    case "addAlbumTags": {
      const tags = op.tagIds.filter((id) => d.tags.some((t) => t.id === id));
      const albums = op.albumIds.map((id) => {
        const album = d.albums.find((a) => a.id === id);
        if (!album) throw Error("所选写真集已不存在");
        return album;
      });
      const mediaIds = new Set(albums.flatMap((a) => a.mediaIds));
      albums.forEach((a) => {
        a.tags = [...new Set([...a.tags, ...tags])];
      });
      if (op.includeMedia)
        d.media
          .filter((m) => mediaIds.has(m.id))
          .forEach((m) => {
            m.tags = [...new Set([...m.tags, ...tags])];
          });
      break;
    }
    case "removeTag": {
      if (op.group) {
        const tags = d.tags.filter((t) => t.groupId === op.id);
        if (tags.length) {
          let ungrouped = d.groups.find(
            (g) => g.id !== op.id && g.name === "未分组",
          );
          if (!ungrouped) {
            ungrouped = { id: crypto.randomUUID(), name: "未分组" };
            d.groups.push(ungrouped);
          }
          tags.forEach((t) => {
            t.groupId = ungrouped.id;
          });
        }
        d.groups = d.groups.filter((g) => g.id !== op.id);
        break;
      }
      const ids = op.group
        ? d.tags.filter((t) => t.groupId === op.id).map((t) => t.id)
        : [op.id];
      d.tags = d.tags.filter((t) => !ids.includes(t.id));
      if (op.group) d.groups = d.groups.filter((g) => g.id !== op.id);
      d.albums.forEach(
        (a) => (a.tags = a.tags.filter((id) => !ids.includes(id))),
      );
      d.media.forEach(
        (m) => (m.tags = m.tags.filter((id) => !ids.includes(id))),
      );
      break;
    }
  }
}
