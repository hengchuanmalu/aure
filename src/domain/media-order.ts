/** Keep each kind's existing order; album videos always follow all photos. */
export function photosFirst<T extends { kind: "image" | "video" }>(
  items: readonly T[],
): T[] {
  const photos: T[] = [];
  const videos: T[] = [];
  for (const item of items)
    (item.kind === "video" ? videos : photos).push(item);
  return photos.concat(videos);
}
