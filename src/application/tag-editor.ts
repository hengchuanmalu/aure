import { type Database } from "@/domain/types";

export type TagCategory =
  { kind: "existing"; id: string } | { kind: "new"; name: string };
export type TagDraft = { id?: string; name: string; category?: TagCategory };
export class TagDraftError extends Error {}

/** Validate the entire draft before adding its category and tag to one repository transaction. */
export function saveTagDraft(db: Database, draft: TagDraft) {
  const name = draft.name.trim();
  if (!name) throw new TagDraftError("请输入标签名称");
  if (Array.from(name).length > 20)
    throw new TagDraftError("标签名称最多 20 个字");
  const existingTag = draft.id
    ? db.tags.find((tag) => tag.id === draft.id)
    : undefined;
  if (draft.id && !existingTag)
    throw new TagDraftError("标签已不存在，请关闭后重试");
  const category = draft.category;
  const categoryName =
    category?.kind === "new" ? category.name.trim() : "未分组";
  if (category?.kind === "new" && !categoryName)
    throw new TagDraftError("请输入分类名称");
  const group =
    category?.kind === "existing"
      ? db.groups.find((group) => group.id === category.id)
      : db.groups.find(
          (group) =>
            group.name.trim().toLocaleLowerCase() ===
            categoryName.toLocaleLowerCase(),
        );
  if (draft.category?.kind === "existing" && !group)
    throw new TagDraftError("所选分类已不存在，请重新选择");
  if (
    group &&
    db.tags.some(
      (tag) =>
        tag.groupId === group.id &&
        tag.id !== draft.id &&
        tag.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    throw new TagDraftError("此分类已存在同名标签");
  }
  const groupId = group?.id || crypto.randomUUID();
  if (!group) db.groups.push({ id: groupId, name: categoryName });
  const id = existingTag?.id || crypto.randomUUID();
  if (existingTag) Object.assign(existingTag, { name, groupId });
  else db.tags.push({ id, name, groupId });
  return id;
}
