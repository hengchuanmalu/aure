import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Tag, TagGroup } from '@/domain/types';
import { Input } from '@/ui/SearchInput';
import { TagLabel } from '@/ui/TagLabel';

export function TagNameInput({ id, value, tags, groups, groupId, disabled, onChange, onChoose, onNew }: {
  id: string;
  value: string;
  tags: Tag[];
  groups: TagGroup[];
  groupId?: string;
  disabled: boolean;
  onChange: (name: string) => void;
  onChoose: (tag: Tag) => void;
  onNew: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const allowSelection = useRef(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [selection, setSelection] = useState('__none__');
  const [ime, setIme] = useState(false);
  const needle = value.trim().toLocaleLowerCase();
  const matching = tags.filter(tag => tag.name.toLocaleLowerCase().includes(needle));
  const canCreate = !!needle && !tags.some(tag => tag.groupId === groupId && tag.name.trim().toLocaleLowerCase() === needle);
  const open = focused && !dismissed && !disabled && !ime;
  const close = () => { setDismissed(true); setSelection('__none__'); allowSelection.current = false; };
  const choose = (tag?: Tag) => { close(); tag ? onChoose(tag) : onNew(); input.current?.focus(); };
  return <Popover.Root open={open} onOpenChange={value => { if (!value) close(); }}>
    <Command className="tag-name-combobox" shouldFilter={false} value={selection} vimBindings={false}
      onValueChange={value => { if (allowSelection.current) setSelection(value); }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault();
          event.stopPropagation(); return;
        }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          allowSelection.current = true;
          if (!open) { setDismissed(false); event.preventDefault(); }
        } else if (event.key === 'Enter') {
          // Typing alone keeps the name as a draft; never submit the outer form from a candidate list.
          if (open) {
            event.preventDefault(); event.stopPropagation();
            const selected = matching.find(tag => tag.id === selection);
            if (selected) choose(selected);
            else if (selection === '__new__' && canCreate) choose();
            else close();
          }
        } else if (event.key === 'Home' || event.key === 'End') event.stopPropagation();
      }}>
      <Popover.Anchor asChild><div>
        <Command.Input asChild value="" onValueChange={name => {
          onChange(Array.from(name).slice(0, 20).join(''));
          setDismissed(false); setSelection('__none__'); allowSelection.current = false;
        }}>
          <Input ref={input} id={id} autoFocus aria-label="标签名称" aria-describedby={`${id}-count`}
            placeholder="搜索或输入新标签" value={value} disabled={disabled} autoComplete="off"
            aria-expanded={open}
            onFocus={() => setFocused(true)}
            onBlur={event => { if (!content.current?.contains(event.relatedTarget as Node)) { setFocused(false); close(); } }}
            onCompositionStart={() => { composing.current = true; setIme(true); }}
            onCompositionEnd={event => { composing.current = false; setIme(false); onChange(Array.from(event.currentTarget.value).slice(0, 20).join('')); }}
            contentAfter={<small id={`${id}-count`} className="tag-name-count" aria-live="polite">{Array.from(value).length}/20</small>} />
        </Command.Input>
      </div></Popover.Anchor>
      <Popover.Portal>
        <Popover.Content ref={content} className="tag-name-menu" data-slot="popover-content" aria-label="标签名称候选"
          inert={!open} aria-hidden={!open} sideOffset={6} collisionPadding={16}
          onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => { if (input.current?.parentElement?.contains(event.target as Node)) event.preventDefault(); }}
          onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }}
          onPointerMove={() => { allowSelection.current = true; }}>
          <Command.List className="tag-name-options" aria-label="已有标签">
            {matching.map(tag => <Command.Item key={tag.id} value={tag.id} className="tag-name-option" onSelect={() => choose(tag)}>
              <TagLabel>{tag.name}</TagLabel><small>{groups.find(group => group.id === tag.groupId)?.name || '未分组'}</small>
            </Command.Item>)}
            {canCreate && <Command.Item value="__new__" className="tag-name-option" onSelect={() => choose()}><Plus aria-hidden="true" /><span>使用新标签「{value.trim()}」</span></Command.Item>}
            {!matching.length && !canCreate && <div className="tag-name-empty">输入名称以搜索或创建标签</div>}
          </Command.List>
        </Popover.Content>
      </Popover.Portal>
    </Command>
  </Popover.Root>;
}
