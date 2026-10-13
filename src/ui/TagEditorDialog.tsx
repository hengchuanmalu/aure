import { saveTagDraft,TagDraftError,type TagCategory } from "@/application/tag-editor";
import { Modal } from '@/ui/Modal';
import { Confirm } from '@/ui/Confirm';
import { TagNameInput } from '@/ui/TagNameInput';
import { type Tag, type TagGroup } from '@/domain/types';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { Input } from "@/ui/SearchInput";
import { Check,ChevronDown,Plus,X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId,useRef,useState } from 'react';

function CategoryPicker({ value, onChange, disabled }: { value?: TagCategory; onChange: (category?: TagCategory) => void; disabled: boolean }) {
  const { db, act, notice } = useData();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<TagGroup>();
  const composing = useRef(false);
  const needle = query.trim();
  const matching = db.groups.filter(group => group.name !== '未分组' && group.name.toLocaleLowerCase().includes(needle.toLocaleLowerCase()));
  const exact = db.groups.find(group => group.name.trim().toLocaleLowerCase() === needle.toLocaleLowerCase());
  const label = value?.kind === 'new' ? value.name : value?.kind === 'existing' ? db.groups.find(group => group.id === value.id)?.name : '';
  const choose = (category?: TagCategory) => { onChange(category); setOpen(false); setQuery(''); };
  const ungroupedSelected = !value || (value.kind === 'existing' && db.groups.find(group => group.id === value.id)?.name === '未分组');
  return <><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button className="tag-category-trigger" aria-label="标签分类" disabled={disabled}>
        <span className={!label ? 'muted' : ''}>{label || '选择或创建分类'}</span><ChevronDown aria-hidden="true" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="tag-category-menu" data-slot="popover-content" inert={!open} aria-hidden={!open} sideOffset={6} collisionPadding={16} aria-label="标签分类选项">
        <Input aria-label="搜索或创建分类" placeholder="搜索或输入新分类" value={query} onChange={event => setQuery(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.key === 'Enter' && needle) { event.preventDefault(); choose(exact ? { kind: 'existing', id: exact.id } : { kind: 'new', name: needle }); }
          }} />
        <div className="tag-category-options">
          {'未分组'.includes(needle) && <Button variant="ghost" onClick={() => choose()}>未分组{ungroupedSelected && <Check aria-hidden="true" />}</Button>}
          {matching.map(group => <div className="tag-category-row" key={group.id}>
            <Button variant="ghost" className="tag-category-select" onClick={() => choose({ kind: 'existing', id: group.id })}>
              <span>{group.name}</span>{value?.kind === 'existing' && value.id === group.id && <Check aria-hidden="true" />}
            </Button>
            <Button variant="ghost" className="tag-category-remove" size="icon" aria-label={`删除分类 ${group.name}`} onClick={() => { setOpen(false); setDeleting(group); }}><X aria-hidden="true" /></Button>
          </div>)}
          {needle && !exact && <Button variant="ghost" icon={<Plus />} onClick={() => choose({ kind: 'new', name: needle })}>创建「{needle}」</Button>}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
    {deleting && <Confirm title={`删除分类「${deleting.name}」？`} confirmLabel="删除分类"
      text="组内标签会移到未分组，写真、媒体和已有标签关联保持不变。此操作独立于标签草稿，确认后立即生效。"
      onClose={() => { setDeleting(undefined); setOpen(true); }}
      onConfirm={async () => {
        await act({ type: 'removeTag', id: deleting.id, group: true });
        if (value?.kind === 'existing' && value.id === deleting.id) onChange();
        notice('分类已删除，组内标签已移到未分组');
      }} />}
  </>;
}

export function TagEditorDialog({ tag, groupId, onClose }: { tag?: Tag; groupId?: string; onClose: () => void }) {
  const { db, mutate, notice } = useData();
  const id = useId();
  const [name, setName] = useState(tag?.name || '');
  const [editingId, setEditingId] = useState(tag?.id);
  const [category, setCategory] = useState<TagCategory | undefined>(() => (tag?.groupId || groupId) ? { kind: 'existing', id: (tag?.groupId || groupId)! } : undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const close = () => { if (!pending.current) onClose(); };
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setError(''); setBusy(true);
    try {
      await mutate(db => { saveTagDraft(db, { id: editingId, name, category }); });
      onClose(); notice(editingId ? '标签已保存' : '标签已创建');
    } catch (error) { setError(error instanceof TagDraftError ? error.message : '保存失败，请重试'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Modal title={editingId ? '编辑标签' : '添加标签'} className="tag-editor-modal" onClose={close} footer={<>
    {error && <span className="tag-editor-error error" role="alert">{error}</span>}
    <Button onClick={close} disabled={busy}>取消</Button>
    <Button variant="default" type="submit" form={`${id}-form`} disabled={busy}>{busy ? '正在保存…' : editingId ? '保存' : '创建'}</Button>
  </>}>
    <form id={`${id}-form`} className="tag-editor-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={`${id}-name`}>标签名称</label>
      <TagNameInput id={`${id}-name`} value={name} tags={db.tags} groups={db.groups} disabled={busy}
        groupId={category?.kind === 'existing' ? category.id : db.groups.find(group => group.name === (category?.kind === 'new' ? category.name : '未分组'))?.id}
        onChange={next => { setName(next); if (!tag) setEditingId(undefined); }}
        onChoose={existing => { setName(existing.name); setEditingId(existing.id); setCategory({ kind: 'existing', id: existing.groupId }); setError(''); }}
        onNew={() => { setEditingId(undefined); setError(''); }} />
      <label>标签分类</label>
      <CategoryPicker value={category} onChange={setCategory} disabled={busy} />
    </form>
  </Modal>;
}
