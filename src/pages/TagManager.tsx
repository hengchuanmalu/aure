import { Confirm } from '@/ui/Confirm';
import { Empty } from '@/ui/Empty';
import { Modal } from '@/ui/Modal';
import { catalog } from "@/domain/catalog";
import { uid } from '@/domain/database';
import { type Tag } from '@/domain/types';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { Field } from '@/ui/Field';
import { TagEditorDialog } from "@/ui/TagEditorDialog";
import { TagLabel } from "@/ui/TagLabel";
import { Plus,X } from 'lucide-react';
import { useRef,useState } from 'react';
import { Link,useOutletContext } from 'react-router-dom';

export default function TagManager() {
  const { db, page, mutate, act } = useData();
  const { openTagDialog } = useOutletContext<{ openTagDialog: (options?: { groupId?: string }) => void }>();
  const [groupForm, setGroupForm] = useState<{ id?: string; name: string }>();
  const [editing, setEditing] = useState<Tag>();
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<{ kind: 'group' | 'tag'; id: string }>();
  const [groupSaving, setGroupSaving] = useState(false);
  const groupPending = useRef(false);
  const closeGroup = () => { if (!groupPending.current) setGroupForm(undefined); };
  const saveGroup = async () => {
    if (!groupForm || groupPending.current) return;
    const name = groupForm.name.trim();
    if (!name) { setError('名称不能为空'); return; }
    if (db.groups.some(group => group.name === name && group.id !== groupForm.id)) { setError('分组名称不能重复'); return; }
    groupPending.current = true;
    setGroupSaving(true);
    setError('');
    try {
      await mutate(draft => {
        if (groupForm.id) draft.groups.find(group => group.id === groupForm.id)!.name = name;
        else draft.groups.push({ id: uid(), name });
      });
      setGroupForm(undefined);
    } catch { setError('保存失败，请重试'); }
    finally { groupPending.current = false; setGroupSaving(false); }
  };
  return <div className="page-pad">
    <div className="page-heading">
      <h1><Link to="/tags" aria-label="返回标签浏览">标签</Link></h1>
      <Button variant="default" icon={<Plus />} onClick={() => { setError(''); setGroupForm({ name: '' }); }}>新建分组</Button>
    </div>
    {db.groups.map(group => <section className="tag-group" key={group.id}>
      <div className="section-title">
        <h2>{group.name}<small>{db.tags.filter(tag => tag.groupId === group.id).length} 个标签</small></h2>
        <div className="row">
          <Button variant="ghost" onClick={() => { setError(''); setGroupForm({ id: group.id, name: group.name }); }}>重命名</Button>
          <Button variant="ghost" onClick={() => setDeleting({ kind: 'group', id: group.id })}>删除分组</Button>
        </div>
      </div>
      <div className="tag-management-list">
        {db.tags.filter(tag => tag.groupId === group.id).map(tag => <div className="tag-item" key={tag.id}>
          <Link to={`/library?tag=${tag.id}`}><TagLabel>{tag.name}</TagLabel><small>
            {page?.tagAlbumCounts?.[tag.id] ?? catalog(db).tagCounts.get(tag.id) ?? 0} 本 · {page?.tagMediaCounts?.[tag.id] ?? catalog(db).media.tagCounts.get(tag.id) ?? 0} 项
          </small></Link>
          <Button variant="ghost" aria-label={`编辑标签 ${tag.name}`} onClick={() => setEditing(tag)}>编辑</Button>
          <Button variant="ghost" aria-label={`删除标签 ${tag.name}`} onClick={() => setDeleting({ kind: 'tag', id: tag.id })}><X size={16} /></Button>
        </div>)}
        <Button variant="ghost" icon={<Plus />} onClick={() => openTagDialog({ groupId: group.id })}>添加标签</Button>
      </div>
    </section>)}
    {!db.groups.length && <Empty title="还没有标签分组" />}
    {editing && <TagEditorDialog tag={editing} onClose={() => setEditing(undefined)} />}
    {groupForm && <Modal title={groupForm.id ? '编辑分组' : '新建分组'} onClose={closeGroup} footer={<>
      <span className="error" role="alert">{error}</span>
      <Button onClick={closeGroup} disabled={groupSaving}>取消</Button>
      <Button variant="default" disabled={groupSaving} onClick={() => void saveGroup()}>{groupSaving ? '正在保存…' : '保存'}</Button>
    </>}><fieldset disabled={groupSaving}><Field label="名称" value={groupForm.name} onChange={name => setGroupForm({ ...groupForm, name })} /></fieldset></Modal>}
    {deleting && <Confirm title={deleting.kind === 'group' ? '删除分组？' : '删除标签？'} text={deleting.kind === 'group' ? '组内标签会移到未分组，已有标签关联保持不变。' : '将解除这个标签的关联，写真和媒体不会删除。'} onClose={() => setDeleting(undefined)}
      onConfirm={async () => { await act({ type: 'removeTag', id: deleting.id, group: deleting.kind === 'group' }); setDeleting(undefined); }} />}
  </div>;
}
