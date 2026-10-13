import { type Tag, type TagGroup } from "@/domain/types";
import { useData } from "@/state/data-context";
import { TagLabel } from "@/ui/TagLabel";
export function TagPicker({
  value,
  onChange,
  onToggle,
  tags: suppliedTags,
  groups: suppliedGroups,
  layout = "chips",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  onToggle?: (id: string) => void;
  tags?: Tag[];
  groups?: TagGroup[];
  layout?: "chips" | "list";
}) {
  const { db } = useData();
  const tags = suppliedTags || db.tags;
  const groups = suppliedGroups || db.groups;
  const toggle = (id: string) => {
    if (onToggle) onToggle(id);
    else onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  };
  if (layout === "list") {
    const knownGroups = new Set(groups.map((group) => group.id));
    const sections = groups.map((group) => ({
      id: group.id,
      name: group.name,
      tags: tags.filter((tag) => tag.groupId === group.id),
    }));
    const ungrouped = tags.filter((tag) => !knownGroups.has(tag.groupId));
    if (ungrouped.length) sections.push({ id: "ungrouped", name: "其他标签", tags: ungrouped });
    return (
      <div className="tag-picker tag-picker-list">
        {sections.filter((section) => section.tags.length).map((section) => (
          <fieldset className="tag-list-group" key={section.id}>
            <legend>{section.name}</legend>
            {section.tags.map((tag) => (
              <button
                type="button"
                className="tag-list-option"
                key={tag.id}
                aria-pressed={value.includes(tag.id)}
                onClick={() => toggle(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </fieldset>
        ))}
      </div>
    );
  }
  return (
    <div className="tag-picker">
      {groups.map((g) => (
        <div key={g.id}>
          <small>{g.name}</small>
          <div className="chips">
            {tags
              .filter((t) => t.groupId === g.id)
              .map((t) => (
                <button
                  type="button"
                  className={`chip ${value.includes(t.id) ? "active" : ""}`}
                  aria-pressed={value.includes(t.id)}
                  key={t.id}
                  onClick={() => toggle(t.id)}
                >
                  <TagLabel>{t.name}</TagLabel>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
