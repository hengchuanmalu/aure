import { avatarCrop,avatarImageStyle,clamp,type AvatarCrop } from "@/domain/avatar-crop";
import { type Album,type MediaItem,type ModelProfile } from '@/domain/types';
import { readCandidates } from '@/infrastructure/desktop-repository';
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { AvatarPhotos } from "@/ui/AvatarPhotos";
import { HoverHint } from "@/ui/HoverHint";
import { Photo } from "@/ui/Photo";
import { Check,ChevronLeft,ChevronRight,Heart,ImagePlus,Minus,Plus,RotateCcw } from 'lucide-react';
import { useEffect,useRef,useState,type KeyboardEvent,type PointerEvent } from 'react';

export function AvatarEditor({ model, albumIds, custom, disabled, onChange, onSelectFile }: {
  model: ModelProfile; albumIds: string[]; custom?: MediaItem; disabled: boolean;
  onChange: (patch: Partial<ModelProfile>) => void; onSelectFile: () => void;
}) {
  const { db, page } = useData();
  const [source, setSource] = useState('favorites');
  const [albumPage, setAlbumPage] = useState(0);
  const [remoteAlbums, setRemoteAlbums] = useState<{ items: Album[]; total: number }>();
  const [albumError, setAlbumError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const idsKey = JSON.stringify(albumIds);
  const crop = avatarCrop(model);
  const stage = useRef<HTMLDivElement>(null);
  const wheelContext = useRef({ model, disabled, onChange });
  wheelContext.current = { model, disabled, onChange };
  useEffect(() => {
    const element = stage.current!;
    const zoom = (event: WheelEvent) => {
      const current = wheelContext.current;
      if (current.disabled || !current.model.avatar || !event.deltaY) return;
      event.preventDefault();
      const crop = avatarCrop(current.model);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = { ...crop, zoom: clamp(+(crop.zoom * Math.exp(-clamp(delta, -120, 120) * 0.001)).toFixed(2), 1, 3) };
      drag.current = undefined;
      current.model = { ...current.model, avatarCrop: next };
      current.onChange({ avatarCrop: next });
    };
    element.addEventListener('wheel', zoom, { passive: false });
    return () => element.removeEventListener('wheel', zoom);
  }, []);
  const drag = useRef<{ pointer: number; clientX: number; clientY: number; crop: AvatarCrop; overflowX: number; overflowY: number } | undefined>(undefined);
  useEffect(() => {
    setAlbumPage(0);
    setSource(current => current === 'favorites' || albumIds.includes(current) ? current : 'favorites');
  }, [idsKey]);
  useEffect(() => {
    if (!page) return;
    let alive = true;
    setAlbumError('');
    void readCandidates<Album>('albums', albumPage, { ids: JSON.parse(idsKey) }).then(result => {
      if (alive) setRemoteAlbums(result);
    }, error => { if (alive) setAlbumError(String(error)); });
    return () => { alive = false; };
  }, [!!page, idsKey, albumPage, attempt]);
  const localAlbums = db.albums.filter(album => albumIds.includes(album.id));
  const albums = page ? remoteAlbums?.items ?? [] : localAlbums.slice(albumPage * 48, (albumPage + 1) * 48);
  const totalAlbums = page ? remoteAlbums?.total ?? 0 : localAlbums.length;
  const albumPages = Math.ceil(totalAlbums / 48);
  const selectedAlbum = db.albums.find(album => album.id === source);
  const query = { kind: 'image', ...(source === 'favorites' ? { favorite: true } : { album: source }) };
  const items = db.media.filter(item => item.kind === 'image' &&
    (source === 'favorites' ? item.favorite : selectedAlbum?.mediaIds.includes(item.id)));
  const updateCrop = (patch: Partial<AvatarCrop>) => {
    if (disabled || !model.avatar) return;
    const next = { ...crop, ...patch };
    onChange({ avatarCrop: next, avatarFocus: next.y });
  };
  const choose = (item: MediaItem) => onChange({ avatar: item.src, avatarFocus: 50, avatarCrop: { x: 50, y: 50, zoom: 1 } });
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    const image = stage.current?.querySelector('img');
    if (disabled || !image?.naturalWidth || event.button !== 0) return;
    const size = event.currentTarget.getBoundingClientRect().width;
    const cover = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    drag.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, crop,
      overflowX: image.naturalWidth * cover * crop.zoom - size,
      overflowY: image.naturalHeight * cover * crop.zoom - size };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId || disabled) return;
    updateCrop({
      x: start.overflowX > 0.5 ? clamp(start.crop.x - (event.clientX - start.clientX) / start.overflowX * 100, 0, 100) : start.crop.x,
      y: start.overflowY > 0.5 ? clamp(start.crop.y - (event.clientY - start.clientY) / start.overflowY * 100, 0, 100) : start.crop.y,
    });
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, Partial<AvatarCrop>> = {
      ArrowLeft: { x: clamp(crop.x - 2, 0, 100) }, ArrowRight: { x: clamp(crop.x + 2, 0, 100) },
      ArrowUp: { y: clamp(crop.y - 2, 0, 100) }, ArrowDown: { y: clamp(crop.y + 2, 0, 100) },
    };
    if (moves[event.key]) { event.preventDefault(); updateCrop(moves[event.key]); }
  };
  return <div className="avatar-editor">
    <section className="avatar-preview-panel" aria-labelledby="avatar-preview-heading">
      <div className="avatar-section-heading"><h3 id="avatar-preview-heading">当前头像</h3>
        <Button variant="ghost" aria-label="重置头像裁切" title="重置裁切" disabled={disabled || !model.avatar}
          icon={<RotateCcw />} onClick={() => updateCrop({ x: 50, y: 50, zoom: 1 })} />
      </div>
      <div className="avatar-crop-stage" ref={stage} role="group" tabIndex={model.avatar && !disabled ? 0 : -1}
        aria-label="头像裁切区域" onKeyDown={moveWithKeyboard}
        onPointerDown={beginDrag} onPointerMove={moveDrag}
        onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
        onLostPointerCapture={() => { drag.current = undefined; }}>
        {model.avatar ? <Photo src={model.avatar} sourcePath={custom?.src === model.avatar ? custom.sourcePath : undefined}
          style={avatarImageStyle(crop)} /> : <div className="avatar-empty"><ImagePlus /><span>选择一张照片作为头像</span></div>}
        {model.avatar && <span className="avatar-crop-mask" aria-hidden="true" />}
      </div>
      <div className="avatar-zoom-controls">
        <Button variant="ghost" aria-label="缩小头像" icon={<Minus />} disabled={disabled || !model.avatar || crop.zoom <= 1}
          onClick={() => updateCrop({ zoom: Math.max(1, +(crop.zoom - 0.1).toFixed(2)) })} />
        <input aria-label="头像缩放" type="range" min={100} max={300} step={1} value={Math.round(crop.zoom * 100)}
          disabled={disabled || !model.avatar} onChange={event => updateCrop({ zoom: +event.target.value / 100 })} />
        <Button variant="ghost" aria-label="放大头像" icon={<Plus />} disabled={disabled || !model.avatar || crop.zoom >= 3}
          onClick={() => updateCrop({ zoom: Math.min(3, +(crop.zoom + 0.1).toFixed(2)) })} />
        <output>{Math.round(crop.zoom * 100)}%</output>
      </div>
    </section>
    <section className="avatar-selection-panel" aria-labelledby="avatar-selection-heading">
      <div className="avatar-section-heading"><h3 id="avatar-selection-heading">选择照片</h3></div>
      <div className="avatar-sources" role="group" aria-label="头像图片来源">
        <button type="button" className="avatar-source" aria-pressed={source === 'favorites'} disabled={disabled} onClick={() => setSource('favorites')}><Heart />收藏</button>
        {albums.map(album => <HoverHint text={album.name} key={album.id}><button key={album.id} type="button" className="avatar-source" aria-pressed={source === album.id}
          disabled={disabled} onClick={() => setSource(album.id)} >
          <Photo src={album.cover} style={album.coverCrop ? avatarImageStyle(album.coverCrop) : undefined} retryable={false} /><span>{album.name}</span>
        </button></HoverHint>)}
      </div>
      {albumError && <p role="alert" className="avatar-source-error">写真集读取失败 <Button onClick={() => setAttempt(n => n + 1)}>重试</Button></p>}
      {albumPages > 1 && <div className="avatar-album-pages">
        <Button variant="ghost" aria-label="上一组写真集" icon={<ChevronLeft />} disabled={!albumPage || disabled} onClick={() => setAlbumPage(n => n - 1)} />
        <Button variant="ghost" aria-label="下一组写真集" icon={<ChevronRight />} disabled={albumPage + 1 >= albumPages || disabled} onClick={() => setAlbumPage(n => n + 1)} />
      </div>}
      <AvatarPhotos remote={!!page} query={query} items={items} selected={model.avatar} disabled={disabled}
        emptyText={source === 'favorites' ? '暂无收藏的图片' : '这个写真集还没有图片'} onChoose={choose} />
      {custom && <button type="button" className="avatar-local-selection" disabled={disabled} aria-pressed={model.avatar === custom.src} onClick={() => choose(custom)}>
        <Photo src={custom.src} sourcePath={custom.sourcePath} retryable={false} /><span>{custom.name}</span>{model.avatar === custom.src && <Check />}
      </button>}
      <Button className="avatar-local-button" icon={<ImagePlus />} disabled={disabled} onClick={onSelectFile}>从本地选择图片</Button>
    </section>
  </div>;
}
