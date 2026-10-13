import { pathKey, type FolderScan } from "@/domain/importing";
import { photosFirst } from "@/domain/media-order";
import { markManualImportFields } from "@/domain/import-metadata";
import {
  IMPORT_RULE_VERSION,
  matchAlbumMetadata,
  resolveModelName,
} from "@/application/album-matching";
import {
  type Album,
  type Database,
  type MediaItem,
  type ModelProfile,
  type Tag,
  type TagGroup,
} from "@/domain/types";

/** Transient entities stay outside the catalog until the editor's single save. */
export type PreparedAlbumImport = {
  folder: FolderScan;
  album: Album;
  media: MediaItem[];
  models: ModelProfile[];
  tags: Tag[];
  groups: TagGroup[];
};
const key = (name: string) => name.trim().toLocaleLowerCase();
function named<T extends { name: string }>(
  items: T[],
  name: string,
  create: () => T,
): T {
  const found = items.filter((item) => key(item.name) === key(name));
  if (found.length > 1)
    throw Error(`存在同名资料，请先在图库中消除歧义：${name}`);
  return found[0] || create();
}
export function prepareAlbumImport(
  folder: FolderScan,
  db: Database,
  sources: Record<string, string>,
  id: string,
): PreparedAlbumImport {
  const matched = matchAlbumMetadata(folder, db);
  const manifest = matched.manifest;
  if (
    db.albums.some(
      (a) =>
        a.sourceDirectory &&
        pathKey(a.sourceDirectory) === pathKey(folder.path),
    )
  )
    throw Error("该文件夹已导入，请编辑已有写真集");
  const existingMedia = new Map(
    db.media
      .filter((m) => m.sourcePath)
      .map((m) => [pathKey(m.sourcePath!), m]),
  );
  const media = folder.files.map((file) => {
    const existing = existingMedia.get(pathKey(file.path));
    if (existing) return existing;
    if (!sources[file.path]) throw Error("媒体资源地址缺失");
    return {
      id: crypto.randomUUID(),
      kind: file.kind,
      sourcePath: file.path,
      src: sources[file.path],
      name: file.name,
      size: file.size,
      width: 0,
      height: 0,
      tags: [],
      favorite: false,
      liked: false,
      rating: 0,
    } satisfies MediaItem;
  });
  const cover = media.find(
    (m) => m.name.toLocaleLowerCase() === manifest.cover.toLocaleLowerCase(),
  );
  const models = manifest.models.flatMap((name) => {
    const candidates = resolveModelName(db.models, name);
    if (candidates.length > 1) {
      matched.unresolved.push(`模特名称不唯一：${name}`);
      return [];
    }
    return [
      candidates[0] ||
        ({
          id: crypto.randomUUID(),
          name,
          alias: "",
          bio: "",
          avatar: cover?.src || "",
          background: "",
          avatarFocus: 50,
          backgroundFocus: 50,
          fields: [],
          links: [],
          photoIds: [],
        } satisfies ModelProfile),
    ];
  });
  const groups: TagGroup[] = [];
  const tags = manifest.tags.flatMap((name) => {
    if (db.tags.filter((tag) => key(tag.name) === key(name)).length > 1) {
      matched.unresolved.push(`标签名称不唯一：${name}`);
      return [];
    }
    return [
      named(db.tags, name, () => {
        const group =
          groups[0] ||
          named(db.groups, "导入标签", () => ({
            id: crypto.randomUUID(),
            name: "导入标签",
          }));
        if (!groups.length) groups.push(group);
        return { id: crypto.randomUUID(), name, groupId: group.id };
      }),
    ];
  });
  const date = new Date().toISOString().slice(0, 10);
  const album: Album = {
    id,
    name: manifest.name,
    number: manifest.number,
    subtitle: "",
    description: "",
    cover: cover?.src || "",
    coverMediaId: cover?.id,
    sourceDirectory: folder.path,
    sourceFolderName: folder.name,
    declaredPhotoCount: matched.declaredPhotoCount,
    declaredSize: matched.declaredSize,
    mediaIds: photosFirst(media).map((m) => m.id),
    modelIds: [...new Set(models.map((m) => m.id))],
    tags: tags.map((t) => t.id),
    favorite: false,
    createdAt: date,
    updatedAt: date,
    importMetadata: {
      ruleVersion: IMPORT_RULE_VERSION,
      originalName: folder.name,
      fields: {},
      unresolved: matched.unresolved,
    },
  };
  for (const [field, source] of Object.entries(matched.sources)) {
    const name = field as keyof NonNullable<Album["importMetadata"]>["fields"];
    album.importMetadata!.fields[name] = {
      ...source,
      value: structuredClone(album[name] || ""),
    };
  }
  return {
    folder,
    media,
    models,
    tags,
    groups,
    album,
  };
}

/** Resolve paths and names against the complete import context, never a paginated UI snapshot. */
export function commitAlbumImport(
  db: Database,
  pending: PreparedAlbumImport,
  draft: Album,
): void {
  if (!draft.name.trim()) throw Error("请输入写真集名称");
  if (
    db.albums.some(
      (a) =>
        a.sourceDirectory &&
        pathKey(a.sourceDirectory) === pathKey(pending.folder.path),
    )
  )
    throw Error("该文件夹已导入，请编辑已有写真集");
  const next = structuredClone(db);
  const ids = new Map<string, string>();
  const mediaByPath = new Map(
    next.media
      .filter((m) => m.sourcePath)
      .map((m) => [pathKey(m.sourcePath!), m]),
  );
  for (const item of pending.media) {
    const existing = item.sourcePath
      ? mediaByPath.get(pathKey(item.sourcePath))
      : undefined;
    ids.set(item.id, existing?.id || item.id);
    if (!existing) next.media.push(structuredClone(item));
  }
  for (const item of pending.models.filter((m) =>
    draft.modelIds.includes(m.id),
  )) {
    const resolved =
      next.models.find((m) => m.id === item.id) ||
      named(next.models, item.name, () => item);
    ids.set(item.id, resolved.id);
    if (!next.models.some((m) => m.id === resolved.id))
      next.models.push(structuredClone(resolved));
  }
  for (const item of pending.tags.filter((t) => draft.tags.includes(t.id))) {
    const resolved =
      next.tags.find((t) => t.id === item.id) ||
      named(next.tags, item.name, () => item);
    ids.set(item.id, resolved.id);
    if (!next.tags.some((t) => t.id === resolved.id)) {
      const group = pending.groups.find((g) => g.id === resolved.groupId);
      if (group) {
        const actual = named(next.groups, group.name, () => group);
        if (!next.groups.some((g) => g.id === actual.id))
          next.groups.push(structuredClone(actual));
        next.tags.push({ ...resolved, groupId: actual.id });
      } else next.tags.push(structuredClone(resolved));
    }
  }
  const remap = (values: string[]) => [
    ...new Set(values.map((id) => ids.get(id) || id)),
  ];
  const album = {
    ...markManualImportFields(draft),
    name: draft.name.trim(),
    number: draft.number?.trim(),
    sourceDirectory: pending.folder.path,
    sourceFolderName: pending.folder.name,
    mediaIds: remap(pending.album.mediaIds),
    modelIds: remap(draft.modelIds),
    tags: remap(draft.tags),
    coverMediaId: draft.coverMediaId
      ? ids.get(draft.coverMediaId) || draft.coverMediaId
      : undefined,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  // Reference remapping is a catalog operation, not a manual edit.
  for (const field of [
    "modelIds",
    "tags",
    "mediaIds",
    "coverMediaId",
  ] as const) {
    const record = album.importMetadata?.fields[field];
    if (record) record.value = structuredClone(album[field] || "");
  }
  if (
    album.modelIds.some((id) => !next.models.some((m) => m.id === id)) ||
    album.tags.some((id) => !next.tags.some((t) => t.id === id))
  )
    throw Error("部分关联资料已不存在，请重新选择");
  if (album.coverMediaId) {
    const cover = next.media.find(
      (m) => m.id === album.coverMediaId && m.kind === "image",
    );
    if (!cover) throw Error("封面图片已不存在，请重新选择");
    album.cover = cover.src;
  }
  next.albums.unshift(album);
  db.albums = next.albums;
  db.media = next.media;
  db.models = next.models;
  db.tags = next.tags;
  db.groups = next.groups;
}
