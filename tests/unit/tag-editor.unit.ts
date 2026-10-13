import { describe,expect,it } from 'vitest';
import { saveTagDraft,TagDraftError } from "../../src/application/tag-editor";
import { seedFixture } from "../support/demo.fixture";

describe('tag drafts', () => {
  it('adds one new category and tag with a complete reference', () => {
    const db = seedFixture();
    const id = saveTagDraft(db, { name: '  黑丝  ', category: { kind: 'new', name: '  服饰细节  ' } });
    const tag = db.tags.find(tag => tag.id === id)!;
    expect(tag.name).toBe('黑丝');
    expect(db.groups.find(group => group.id === tag.groupId)?.name).toBe('服饰细节');
  });
  it('reuses a matching category and rejects duplicates without changing the draft database', () => {
    const db = seedFixture();
    saveTagDraft(db, { name: '清新', category: { kind: 'new', name: '分类 A' } });
    const before = JSON.stringify(db);
    expect(() => saveTagDraft(db, { name: ' 清新 ', category: { kind: 'new', name: '分类 a' } })).toThrow(TagDraftError);
    expect(JSON.stringify(db)).toBe(before);
  });
  it('rejects blank, overlong and deleted-category drafts before creating any orphan category', () => {
    const db = seedFixture();
    const before = JSON.stringify(db);
    for (const draft of [
      { name: ' ', category: { kind: 'new' as const, name: '不应创建' } },
      { name: '字'.repeat(21), category: { kind: 'new' as const, name: '不应创建' } },
      { name: '有效标签', category: { kind: 'existing' as const, id: 'missing' } },
    ]) expect(() => saveTagDraft(db, draft)).toThrow(TagDraftError);
    expect(JSON.stringify(db)).toBe(before);
    expect(() => saveTagDraft(db, { name: '🖼'.repeat(20) })).not.toThrow();
  });
});
