import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { uid } from '@/domain/database';
import { moveProfileField,profileFieldPreset,profileFieldPresets,profileInputValue,profileStoredValue } from "@/domain/profile-fields";
import { type CustomField } from '@/domain/types';
import { Button } from "@/ui/ActionButton";
import { Input } from "@/ui/SearchInput";
import { GripVertical,Plus,X } from 'lucide-react';
import { useId,useState } from 'react';

export function ProfileFieldsEditor({ fields, onChange }: { fields: CustomField[]; onChange: (fields: CustomField[]) => void }) {
  const prefix = useId();
  const [draggedId, setDraggedId] = useState<string>();
  const [dropId, setDropId] = useState<string>();
  const update = (id: string, patch: Partial<CustomField>) => onChange(fields.map(field => field.id === id ? { ...field, ...patch } : field));
  const add = (label = '') => onChange([...fields, { id: uid(), group: '详细资料', label, value: '' }]);
  return <div className="profile-fields-editor">
    {fields.map((field, index) => {
      const preset = profileFieldPreset(field.label);
      const input = profileInputValue(field);
      const valueId = `${prefix}-${field.id}`;
      const date = preset && 'date' in preset && (!field.value || /^\d{4}-\d{2}-\d{2}$/.test(field.value));
      return <div key={field.id} className="profile-field-row" data-profile-field={field.id} data-drop-target={dropId === field.id}
        onDragOver={event => { if (draggedId) { event.preventDefault(); setDropId(field.id); } }}
        onDrop={event => { if (draggedId) { event.preventDefault(); onChange(moveProfileField(fields, draggedId, field.id)); setDraggedId(undefined); setDropId(undefined); } }}>
        <button className="profile-field-drag" type="button" draggable aria-label={`调整${field.label || '自定义资料'}顺序`}
          onDragStart={event => { setDraggedId(field.id); event.dataTransfer.setData('text/plain', field.id); event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { setDraggedId(undefined); setDropId(undefined); }}
          onKeyDown={event => {
            if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              const target = fields[index + (event.key === 'ArrowUp' ? -1 : 1)];
              if (target) onChange(moveProfileField(fields, field.id, target.id));
            }
          }}><GripVertical aria-hidden="true" /></button>
        {preset ? <label htmlFor={valueId}>{field.label}</label> :
          <Input aria-label={`资料名称 ${index + 1}`} placeholder="名称" value={field.label} onChange={event => update(field.id, { label: event.target.value })} />}
        <Input id={valueId} aria-label={preset ? undefined : `资料内容 ${index + 1}`} placeholder={date ? undefined : '填写内容'}
          type={date ? 'date' : 'text'} value={input.value} inputMode={input.unit ? 'decimal' : undefined}
          contentAfter={input.unit ? <span className="profile-field-unit">{input.unit}</span> : undefined}
          onChange={event => update(field.id, { value: profileStoredValue(field.label, event.target.value) })} />
        <Button variant="ghost" size="icon-sm" icon={<X />} aria-label={`删除${field.label || '自定义资料'}`}
          onClick={() => onChange(fields.filter(current => current.id !== field.id))} />
      </div>;
    })}
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button icon={<Plus />}>添加资料</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {profileFieldPresets.map(preset => <DropdownMenuItem key={preset.label} disabled={fields.some(field => field.label === preset.label)}
          onSelect={() => add(preset.label)}>{preset.label}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => add()}>自定义资料</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
