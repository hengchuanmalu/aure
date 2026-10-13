import { expect,it } from 'vitest';
import { moveProfileField,prepareProfileFields,profileInputValue,profileStoredValue } from "../../src/domain/profile-fields";

it('adds missing starter rows without replacing old IDs, groups, values, duplicates or blank records', () => {
  const fields = [
    { id: 'height', group: '旧分组', label: '身高', value: '168cm' },
    { id: 'other-height', group: '补充', label: '身高', value: '约168' },
    { id: 'legacy', group: '旧分组', label: '备注', value: '原有内容' },
    { id: 'empty', group: '空分组', label: '备注', value: '' },
  ];
  let sequence = 0;
  const result = prepareProfileFields(fields, () => `new-${sequence++}`);
  expect(result).toHaveLength(7);
  for (const field of fields) expect(result.find(next => next.id === field.id)).toEqual(field);
  expect(fields).toHaveLength(4);
  expect(result.filter(field => field.label === '身高')).toHaveLength(2);
});

it('reordering preserves each complete field record', () => {
  const fields = ['a', 'b', 'c'].map(id => ({ id, label: id, value: id, group: '原有分组' }));
  const result = moveProfileField(fields, 'c', 'a');
  expect(result.map(field => field.id)).toEqual(['c', 'a', 'b']);
  expect(result[0]).toEqual(fields[2]);
  expect(moveProfileField(fields, 'unknown', 'a')).toBe(fields);
});

it('shows measurement units once and retains nonnumeric legacy text', () => {
  expect(profileInputValue({ id: 'a', group: '', label: '身高', value: '168 cm' })).toEqual({ value: '168', unit: 'cm' });
  expect(profileInputValue({ id: 'a', group: '', label: '身高', value: '未公开' })).toEqual({ value: '未公开', unit: undefined });
  expect(profileStoredValue('身高', '168.5')).toBe('168.5 cm');
  expect(profileStoredValue('体重', '50')).toBe('50 kg');
  expect(profileStoredValue('身高', '未公开')).toBe('未公开');
});
