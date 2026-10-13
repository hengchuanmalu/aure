import { type CustomField } from "@/domain/types";

export const profileFieldPresets = [
  { label: "身高", unit: "cm", common: true },
  { label: "生日", date: true, common: true },
  { label: "地区", common: true },
  { label: "兴趣", common: true },
  { label: "体重", unit: "kg" },
  { label: "三围" },
  { label: "职业" },
  { label: "血型" },
  { label: "星座" },
  { label: "国籍" },
] as const;

export function profileFieldPreset(label: string) {
  return profileFieldPresets.find((preset) => preset.label === label);
}

/** Starter rows are editor drafts; existing values, IDs and groups stay intact. */
export function prepareProfileFields(
  fields: CustomField[],
  makeId: () => string,
): CustomField[] {
  const common = profileFieldPresets
    .filter((preset) => "common" in preset && preset.common)
    .map(
      (preset) =>
        fields.find((field) => field.label === preset.label) || {
          id: makeId(),
          group: "详细资料",
          label: preset.label,
          value: "",
        },
    );
  const existingIds = new Set(fields.map((field) => field.id));
  return [...fields, ...common.filter((field) => !existingIds.has(field.id))];
}

export function moveProfileField(
  fields: CustomField[],
  sourceId: string,
  targetId: string,
) {
  const source = fields.findIndex((field) => field.id === sourceId);
  const target = fields.findIndex((field) => field.id === targetId);
  if (source < 0 || target < 0 || source === target) return fields;
  const next = [...fields];
  const [field] = next.splice(source, 1);
  next.splice(target, 0, field);
  return next;
}

export function profileInputValue(field: CustomField) {
  const preset = profileFieldPreset(field.label);
  const unit = preset && "unit" in preset ? preset.unit : undefined;
  const numeric = field.value.match(/^(\d+(?:\.\d+)?)\s*(cm|kg)?$/i);
  const matchesUnit =
    numeric && (!numeric[2] || numeric[2].toLowerCase() === unit);
  return {
    value: unit && matchesUnit ? numeric[1] : field.value,
    unit: unit && (!field.value || matchesUnit) ? unit : undefined,
  };
}

export function profileStoredValue(label: string, value: string) {
  const preset = profileFieldPreset(label);
  return preset && "unit" in preset && /^\d+(?:\.\d+)?$/.test(value.trim())
    ? `${value.trim()} ${preset.unit}`
    : value;
}
