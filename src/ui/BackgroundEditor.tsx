import { clamp,type AvatarCrop } from "@/domain/avatar-crop";
import { backgroundCrop,backgroundImageStyle } from "@/domain/background-crop";
import { type Album,type MediaItem,type ModelProfile } from '@/domain/types';
import { readCandidates } from '@/infrastructure/desktop-repository';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { AvatarPhotos } from "@/ui/AvatarPhotos";
import { HoverHint } from "@/ui/HoverHint";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { ModelBackground } from "@/ui/ModelBackground";
import { Photo } from "@/ui/Photo";
import { useBackgroundResolution } from "@/ui/useBackgroundResolution";
import { Check,ChevronLeft,ChevronRight,Heart,ImagePlus,Library,Minus,Plus,RotateCcw } from 'lucide-react';
import { useEffect,useRef,useState,type KeyboardEvent,type PointerEvent } from 'react';

export function BackgroundEditor({ model, albumIds, custom, avatarSourcePath, disabled, onChange, onSelectFile }: {
  model: ModelProfile; albumIds: string[]; custom?: MediaItem; avatarSourcePath?: string; disabled: boolean;
  onChange: (patch: Partial<ModelProfile>) => void; onSelectFile: () => void;
}) {
  const { db, page } = useData();
  const [source, setSource] = useState<'favorites' | 'albums'>('favorites');
  const [albumPage, setAlbumPage] = useState(0);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>();
  const [remoteAlbums, setRemoteAlbums] = useState<{ items: Album[]; total: number }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const idsKey = JSON.stringify(albumIds);
  useEffect(() => {
    if (!page) return;
    let alive = true;
    setError('');
    void readCandidates<Album>('albums', albumPage, { ids: JSON.parse(idsKey) }).then(result => {
      if (alive) setRemoteAlbums(result);
    }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [!!page, idsKey, albumPage, attempt]);
  const localAlbums = db.albums.filter(album => albumIds.includes(album.id));
  const albums = page ? remoteAlbums?.items ?? [] : localAlbums.slice(albumPage * 48, (albumPage + 1) * 48);
  const albumPages = Math.ceil((page ? remoteAlbums?.total ?? 0 : localAlbums.length) / 48);
  const albumId = selectedAlbumId && albumIds.includes(selectedAlbumId) ? selectedAlbumId : albums[0]?.id;
  const selectedAlbum = db.albums.find(album => album.id === albumId);
  const items = db.media.filter(item => item.kind === 'image' && (source === 'favorites' ? item.favorite : selectedAlbum?.mediaIds.includes(item.id)));
  const crop = backgroundCrop(model);
  const stage = useRef<HTMLDivElement>(null);
  const edge = useBackgroundResolution(stage, model.background, crop.zoom);
  const drag = useRef<{ pointer: number; x: number; y: number; crop: AvatarCrop; overflowX: number; overflowY: number } | undefined>(undefined);
  const wheelContext = useRef({ model, disabled, onChange });
  wheelContext.current = { model, disabled, onChange };
  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      const current = wheelContext.current;
      if (current.disabled || !current.model.background || !event.deltaY) return;
      event.preventDefault();
      const crop = backgroundCrop(current.model);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = { ...crop, zoom: clamp(+(crop.zoom * Math.exp(-clamp(delta, -120, 120) * 0.001)).toFixed(2), 1, 3) };
      drag.current = undefined;
      current.model = { ...current.model, backgroundCrop: next };
      current.onChange({ backgroundCrop: next, backgroundFocus: next.y });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => { drag.current = undefined; }, [model.background]);
  const updateCrop = (patch: Partial<AvatarCrop>) => {
    if (disabled || !model.background) return;
    const next = { ...crop, ...patch };
    onChange({ backgroundCrop: next, backgroundFocus: next.y });
  };
  const choose = (item: MediaItem) => onChange({ background: item.src, backgroundFocus: 50, backgroundCrop: { x: 50, y: 50, zoom: 1 } });
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    const image = stage.current?.querySelector('img');
    if (disabled || !image?.naturalWidth || event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const cover = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    event.preventDefault();
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, crop,
      overflowX: image.naturalWidth * cover * crop.zoom - box.width, overflowY: image.naturalHeight * cover * crop.zoom - box.height };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId || disabled) return;
    updateCrop({ x: start.overflowX > .5 ? clamp(start.crop.x - (event.clientX - start.x) / start.overflowX * 100, 0, 100) : start.crop.x,
      y: start.overflowY > .5 ? clamp(start.crop.y - (event.clientY - start.y) / start.overflowY * 100, 0, 100) : start.crop.y });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, Partial<AvatarCrop>> = { ArrowLeft: { x: clamp(crop.x - 2, 0, 100) }, ArrowRight: { x: clamp(crop.x + 2, 0, 100) }, ArrowUp: { y: clamp(crop.y - 2, 0, 100) }, ArrowDown: { y: clamp(crop.y + 2, 0, 100) } };
    if (moves[event.key]) { event.preventDefault(); updateCrop(moves[event.key]); }
  };
  return <div className="background-editor avatar-editor">
    <section className="background-preview-panel">
      <div className="avatar-section-heading"><h3>背景预览</h3><Button variant="ghost" icon={<RotateCcw />} aria-label="重置背景裁切" disabled={disabled || !model.background} onClick={() => updateCrop({ x: 50, y: 50, zoom: 1 })} /></div>
      <div className="background-crop-frame"><div className="background-crop-stage" ref={stage} role="group" aria-label="背景裁切区域" tabIndex={model.background && !disabled ? 0 : -1}
        onKeyDown={keyboard} onPointerDown={beginDrag} onPointerMove={moveDrag}
        onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
        {model.background ? <Photo src={model.background} sourcePath={custom?.src === model.background ? custom.sourcePath : undefined} thumbnailEdge={edge} style={backgroundImageStyle(crop)} /> : <div className="avatar-empty"><ImagePlus /><span>选择一张照片作为背景</span></div>}
        {model.background && <span className="background-crop-grid" aria-hidden="true" />}
      </div></div>
      <div className="avatar-zoom-controls"><span className="background-zoom-label">缩放</span>
        <Button variant="ghost" aria-label="缩小背景" icon={<Minus />} disabled={disabled || !model.background || crop.zoom <= 1} onClick={() => updateCrop({ zoom: Math.max(1, +(crop.zoom - .1).toFixed(2)) })} />
        <input type="range" aria-label="背景缩放" min={100} max={300} step={1} value={Math.round(crop.zoom * 100)} disabled={disabled || !model.background} onChange={event => updateCrop({ zoom: +event.target.value / 100 })} />
        <Button variant="ghost" aria-label="放大背景" icon={<Plus />} disabled={disabled || !model.background || crop.zoom >= 3} onClick={() => updateCrop({ zoom: Math.min(3, +(crop.zoom + .1).toFixed(2)) })} /><output>{Math.round(crop.zoom * 100)}%</output>
      </div>
      <h3 className="background-effect-heading">页面效果</h3>
      <div className="background-page-effect"><div className="background-effect-info"><ModelAvatar model={model} sourcePath={avatarSourcePath} /><div><strong>{model.name || '模特名称'}</strong>{model.alias && <span>{model.alias}</span>}</div></div>
        <ModelBackground model={model} sourcePath={custom?.src === model.background ? custom.sourcePath : undefined} />
      </div>
    </section>
    <section className="avatar-selection-panel background-selection-panel">
      <div className="avatar-section-heading"><h3>选择照片</h3></div>
      <div className="avatar-sources" role="group" aria-label="背景图片来源">
        <button type="button" className="avatar-source" aria-pressed={source === 'favorites'} disabled={disabled} onClick={() => setSource('favorites')}><Heart />收藏</button>
        <button type="button" className="avatar-source" aria-pressed={source === 'albums'} disabled={disabled} onClick={() => setSource('albums')}><Library />关联写真集</button>
      </div>
      {source === 'albums' && <div className="background-albums" role="group" aria-label="背景来源写真集">
        {albums.map(album => <HoverHint text={album.name} key={album.id}><button type="button" className="avatar-source" key={album.id} disabled={disabled} aria-pressed={albumId === album.id} onClick={() => setSelectedAlbumId(album.id)} >{album.name}</button></HoverHint>)}
        {albumPages > 1 && <><Button variant="ghost" icon={<ChevronLeft />} aria-label="上一组背景写真集" disabled={disabled || !albumPage} onClick={() => { setAlbumPage(n => n - 1); setSelectedAlbumId(undefined); }} /><Button variant="ghost" icon={<ChevronRight />} aria-label="下一组背景写真集" disabled={disabled || albumPage + 1 >= albumPages} onClick={() => { setAlbumPage(n => n + 1); setSelectedAlbumId(undefined); }} /></>}
      </div>}
      {source === 'albums' && error ? <p role="alert">写真集读取失败 <Button onClick={() => setAttempt(n => n + 1)}>重试</Button></p> : source === 'albums' && !albumId ? <div className="background-picker-empty">{page && !remoteAlbums ? '正在读取写真集…' : '暂无关联的写真集'}</div> :
        <AvatarPhotos remote={!!page} query={{ kind: 'image', ...(source === 'favorites' ? { favorite: true } : { album: albumId }) }} items={items} selected={model.background} disabled={disabled}
          label="背景照片" purpose="背景" aspectRatio={1.4} emptyText={source === 'favorites' ? '暂无收藏的图片' : '这个写真集还没有图片'} onChoose={choose} />}
      {custom && <button type="button" className="avatar-local-selection" disabled={disabled} aria-pressed={model.background === custom.src} onClick={() => choose(custom)}><Photo src={custom.src} sourcePath={custom.sourcePath} retryable={false} /><span>{custom.name}</span>{model.background === custom.src && <Check />}</button>}
      <Button className="avatar-local-button" icon={<ImagePlus />} disabled={disabled} onClick={onSelectFile}>从本地选择图片</Button>
    </section>
  </div>;
}
