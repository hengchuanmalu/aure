import { batchModelGroups,importBatchEntries,type BatchImportEntry,type PreparedBatchImport } from "@/application/batch-album-import";
import { Confirm } from '@/ui/Confirm';
import { Modal } from '@/ui/Modal';
import { Photo } from '@/ui/Photo';
import { avatarImageStyle } from "@/domain/avatar-crop";
import { type Album } from '@/domain/types';
import type { AlbumEditor } from '@/features/albums/AlbumEditor';
import { readEntity } from '@/infrastructure/desktop-repository';
import { desktop } from '@/infrastructure/tauri-bridge';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { HoverHint } from "@/ui/HoverHint";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft,Check,ChevronRight,FolderOpen,UserRound } from 'lucide-react';
import { useCallback,useMemo,useRef,useState } from 'react';

export function BatchAlbumImport({ initial, onClose, Editor }: { initial: PreparedBatchImport; onClose: () => void; Editor: typeof AlbumEditor }) {
  const { db, act } = useData();
  const [entries, setEntries] = useState(initial.entries);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<{ id: string; saved?: Album }>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const groups = batchModelGroups(entries);
  const avatarPaths = useMemo(() => new Map(initial.entries.flatMap(entry => entry.pending?.media.map(m => [m.src, m.sourcePath] as const) || [])), [initial]);
  const shown = filter === 'all' ? entries : groups.find(g => g.id === filter)?.entries || [];
  const waiting = entries.filter(e => e.pending && (e.status === 'ready' || e.status === 'error'));
  const imported = entries.filter(e => e.status === 'imported').length;
  const skipped = entries.filter(e => e.status === 'duplicate' || !e.pending).length + initial.issues.length;
  const scroll = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => { scroll.current = element; setScrollElement(element); }, []);
  const rows = useVirtualizer({ count: shown.length, getScrollElement: () => scrollElement, estimateSize: () => 88, overscan: 5, getItemKey: index => shown[index].folder.path });
  const update = (path: string, patch: Partial<BatchImportEntry>) => setEntries(items => items.map(item => item.folder.path === path ? { ...item, ...patch } : item));
  const close = () => {
    if (running.current) return;
    waiting.length ? setDiscard(true) : onClose();
  };
  const edit = async (entry: BatchImportEntry) => {
    if (running.current || !entry.album) return;
    setError('');
    if (entry.pending && entry.status !== 'imported') { setEditing({ id: entry.folder.path }); return; }
    running.current = true; setBusy(true);
    try {
      const saved = desktop() ? await readEntity<Album>('albums', entry.album.id) : db.albums.find(a => a.id === entry.album!.id);
      if (!saved) throw Error('写真资料已不存在，请重新打开导入页');
      setEditing({ id: entry.folder.path, saved });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
  };
  const start = async () => {
    if (running.current || !waiting.length) return;
    running.current = true; setBusy(true); setStarted(true); setError('');
    // Each album uses the existing atomic transaction. Failed items remain retryable;
    // successful items are never resubmitted when the user retries the batch.
    try {
      await importBatchEntries(waiting, (pending, album) => act({ type: 'importAlbum', pending, album }),
        (entry, patch) => update(entry.folder.path, patch));
    } finally { running.current = false; setBusy(false); }
  };
  const current = entries.find(e => e.folder.path === editing?.id);
  if (editing && current?.album) return <Editor key={editing.id}
    album={editing.saved} preparedImport={editing.saved ? undefined : current.pending}
    initialDraft={editing.saved || current.album} onClose={() => setEditing(undefined)}
    onDraftSaved={editing.saved ? undefined : album => { update(current.folder.path, { album, status: 'ready', message: undefined }); setEditing(undefined); }} />;

  return <>
    <Modal title="批量导入写真" wide className="album-editor-modal batch-import-modal" onClose={close}
      footer={<><span role="status" className="batch-import-status">{busy ? `正在导入 · 已完成 ${imported} 套` : `待导入 ${waiting.length} 套${imported ? ` · 已导入 ${imported} 套` : ''}${skipped ? ` · 跳过 ${skipped} 项` : ''}`}</span>
        {error && <span role="alert" className="error">{error}</span>}
        <Button disabled={busy} onClick={close}>{started || !waiting.length ? '完成' : '取消'}</Button>
        {!!waiting.length && <Button variant="default" disabled={busy} onClick={() => void start()}>{busy ? '正在导入…' : started ? `重试剩余 ${waiting.length} 套` : `导入 ${waiting.length} 套写真`}</Button>}
      </>}>
      <div className="batch-import-page" aria-busy={busy}>
        <div className="batch-import-heading"><FolderOpen aria-hidden="true" /><div><h3>{initial.name}</h3><HoverHint text={initial.path}><p >{initial.path}</p></HoverHint></div>
          <span>{groups.filter(g => g.model).length} 位模特 · {entries.length} 套写真</span></div>
        <nav className="batch-import-models" aria-label="按模特核对导入">
          <button type="button" className="batch-model-filter" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); scroll.current?.scrollTo(0, 0); }}>
            <span className="batch-model-avatar batch-model-all"><FolderOpen /></span><strong>全部写真</strong><small>{waiting.length} 套待导入</small>
          </button>
          {groups.map(group => <button type="button" className="batch-model-filter" key={group.id} aria-pressed={filter === group.id}
            onClick={() => { setFilter(group.id); scroll.current?.scrollTo(0, 0); }}>
            <span className="batch-model-avatar">{group.model?.avatar ? <ModelAvatar model={group.model}
              sourcePath={avatarPaths.get(group.model.avatar)} /> : <UserRound />}</span>
            <strong>{group.model?.name || '未关联模特'}</strong>{group.model?.alias && <span className="batch-model-alias">{group.model.alias}</span>}
            <small>{group.entries.filter(e => e.pending && e.status !== 'imported').length} 套待导入</small>
          </button>)}
        </nav>
        <div className="batch-import-list-heading"><h3>{filter === 'all' ? '写真列表' : groups.find(g => g.id === filter)?.model?.name || '未关联模特'}</h3><span>点击文件夹名编辑写真资料</span></div>
        <div className="batch-import-list" ref={attachScroll} tabIndex={0} role="region" aria-label="导入写真列表">
          <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
            {rows.getVirtualItems().map(row => {
              const entry = shown[row.index];
              const images = entry.folder.files.filter(f => f.kind === 'image').length;
              const videos = entry.folder.files.length - images;
              const status = entry.status === 'imported' ? '已导入' : entry.status === 'duplicate' ? '已在图库' : entry.status === 'error' ? entry.pending ? '导入失败' : '无法导入' : '待导入';
              return <div className="batch-import-row" key={row.key} data-index={row.index} ref={rows.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
                <span className="batch-import-cover">{entry.album?.cover ? <Photo src={entry.album.cover} style={entry.album.coverCrop ? avatarImageStyle(entry.album.coverCrop) : undefined} retryable={false}
                  sourcePath={entry.pending?.media.find(m => m.src === entry.album!.cover)?.sourcePath} /> : <FolderOpen />}</span>
                <div className="batch-import-row-info"><HoverHint text={entry.folder.path}><button type="button" disabled={busy || !entry.album} onClick={() => void edit(entry)} >{entry.folder.name}</button></HoverHint>
                  <p>{entry.album?.name && entry.album.name !== entry.folder.name ? `${entry.album.name} · ` : ''}{images} 张图片{videos ? ` · ${videos} 个视频` : ''}</p>
                  {entry.message && <p className={entry.status === 'error' ? 'error' : ''}>{entry.message}</p>}</div>
                <span className="batch-row-status" data-status={entry.status}>{entry.status === 'imported' && <Check />}{status}</span>
                <Button variant="ghost" disabled={busy || !entry.album} aria-label={`编辑 ${entry.folder.name}`} icon={<ChevronRight />} onClick={() => void edit(entry)} />
              </div>;
            })}
          </div>
          {initial.issues.length > 0 && filter === 'all' && <details className="batch-import-issues"><summary>{initial.issues.length} 个目录未能识别</summary>
            {initial.issues.map(issue => <HoverHint text={issue.path} key={issue.path}><p key={issue.path} ><strong>{issue.name}</strong><span>{issue.message}</span></p></HoverHint>)}</details>}
          {!shown.length && <p className="muted">没有可导入的写真，请检查各写真文件夹中的 album.json。</p>}
        </div>
        <p className="batch-import-note"><ArrowLeft aria-hidden="true" />编辑后可返回这里继续核对，确认导入后写入图库。</p>
      </div>
    </Modal>
    {discard && <Confirm title="退出批量导入？" text={`还有 ${waiting.length} 套写真未导入。退出将放弃待导入草稿，已导入的写真会保留。`}
      onClose={() => setDiscard(false)} onConfirm={onClose} />}
  </>;
}
