import { type Album } from "@/domain/types";

export type AlbumSort = "updated" | "created" | "name";
export type SortDirection = "asc" | "desc";

export const albumSortOptions: { value: AlbumSort; label: string }[] = [
  { value: "updated", label: "最近更新" },
  { value: "created", label: "创建日期" },
  { value: "name", label: "名称排序" },
];

export function defaultSortDirection(sort: AlbumSort): SortDirection {
  return sort === "name" ? "asc" : "desc";
}

export function compareAlbums(
  a: Album,
  b: Album,
  sort: AlbumSort,
  direction: SortDirection,
) {
  const order =
    sort === "name"
      ? a.name.localeCompare(b.name, "zh-CN")
      : sort === "created"
        ? a.createdAt.localeCompare(b.createdAt)
        : a.updatedAt.localeCompare(b.updatedAt);
  return (direction === "asc" ? order : -order) || a.id.localeCompare(b.id);
}
