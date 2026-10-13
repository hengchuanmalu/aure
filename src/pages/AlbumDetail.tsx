import { Confirm } from '@/ui/Confirm';
import { Empty } from '@/ui/Empty';
import { MediaCard } from '@/ui/MediaCard';
import { albumMedia,catalog } from "@/domain/catalog";
import { AlbumEditor } from '@/features/albums/AlbumEditor';
import { useData } from '@/state/data-context';
import { stopPreviews } from "@/state/video-preview";
import { rememberSequence } from "@/state/viewer-sequence";
import { Button } from "@/ui/ActionButton";
import { AlbumHero } from "@/ui/AlbumHero";
import { ContinuousLoader } from "@/ui/ContinuousLoader";
import { MediaLayoutGrid } from "@/ui/MediaLayoutGrid";
import { MediaViewControls,useMediaView } from "@/ui/MediaViewControls";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { useLocation,useNavigate,useParams,useSearchParams } from "react-router-dom";

export default function AlbumDetail() {
  const { id } = useParams();
  const { db, page, mutate, act, notice, recordRecent } = useData();
  const [params, setParams] = useSearchParams();
  const [mediaView, setMediaView] = useMediaView();
  const contentStart = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(params.has("edit")),
    [remove, setRemove] = useState(false);
  useEffect(() => {
    if (params.has('edit')) setEditing(true);
  }, [params]);
  const nav = useNavigate();
  const location = useLocation();
  const requestedOrigin = location.state?.albumOrigin;
  const origin = typeof requestedOrigin === 'string' && /^(?:\/(?:models(?:\/[^/?#]+)?|library|tags|favorites|recent)|\/)(?:\?|$)/.test(requestedOrigin)
    ? requestedOrigin : '/library';
  const originPath = origin.split('?')[0];
  const returnLabel = originPath.startsWith('/models') ? '返回模特'
    : originPath === '/' ? '返回发现'
    : originPath === '/favorites' ? '返回收藏'
    : originPath === '/recent' ? '返回最近浏览'
    : originPath === '/tags' ? '返回标签' : '返回写真库';
  const index = catalog(db);
  const a = index.albums.get(id || "");
  const summary = a ? index.summaries.get(a.id) : undefined;
  const hasImages = (summary?.images || 0) > 0;
  const hasVideos = (summary?.videos || 0) > 0;
  const requestedFilter = params.get("type") || "all";
  const filter = requestedFilter === 'image' && (summary?.images || 0) > 0
    ? 'image'
    : requestedFilter === 'video' && (summary?.videos || 0) > 0 ? 'video' : 'all';
  const selectedFilter = filter === 'all' && hasImages !== hasVideos
    ? (hasImages ? 'image' : 'video') : filter;
  const ms = page
    ? (page.visibleMediaIds || []).flatMap((id) => {
        const m = catalog(db).media.byId.get(id);
        return m ? [m] : [];
      })
    : a
      ? albumMedia(a, db).filter((m) => filter === "all" || m.kind === filter)
      : [];
  useEffect(() => {
    // The first native snapshot can arrive after this route mounts. Track the
    // resolved ID to avoid duplicate registration on metadata/filter updates.
    if (id && a)
      void recordRecent({ albumId: id, at: new Date().toISOString() });
  }, [id, a?.id]);
  useEffect(() => {
    if (!a || requestedFilter === filter) return;
    setParams(current => {
      current.delete('type');
      current.delete('page');
      return current;
    }, { replace: true, state: location.state });
  }, [a?.id, requestedFilter, filter, setParams]);
  if (!a) return page?.refreshing
    ? <div className="loading" role="status">正在读取写真集…</div>
    : <Empty title="写真集不存在" />;
  const open = (mediaId: string) =>
    nav(`/viewer/${a.id}/${mediaId}`, {
      state: {
        backgroundLocation: location,
        from: `/album/${a.id}${params.size ? "?" + params.toString() : ""}`,
        ...(page
          ? {}
          : { sequenceKey: rememberSequence(ms.map((m) => m!.id)) }),
      },
    });
  return (
    <>
      <div className="backline album-backline">
        <Button
          variant="ghost"
          icon={<ArrowLeft />}
          onClick={() => nav(origin)}
        >
          {returnLabel}
        </Button>
        <Button variant="ghost" className="album-remove" icon={<Trash2 />}
          aria-label={page ? '移出图库' : '移出演示库'} title={page ? '移出图库' : '移出演示库'}
          onClick={() => setRemove(true)} />
      </div>
      <AlbumHero
        album={a}
        contentStart={contentStart}
        onFavorite={() =>
          void mutate((d) => {
            const album = d.albums.find((x) => x.id === id);
            if (!album) throw Error("写真集已不存在");
            album.favorite = !album.favorite;
          }).catch(() => notice("收藏保存失败，请重试"))
        }
      />
      <div className="page-pad">
        <div ref={contentStart} className="section-title album-content-toolbar">
          <div className="tabs">
            {[
              ["all", "全部内容"],
              ["image", "照片"],
              ["video", "视频"],
            ].filter(([v]) => v === 'all' ? hasImages && hasVideos : v === 'image' ? hasImages : hasVideos).map(([v, n]) => (
              <button
                key={v}
                className={selectedFilter === v ? "active" : ""}
                aria-pressed={selectedFilter === v}
                onClick={() => {
                  setParams(v === "all" ? {} : { type: v }, { state: location.state });
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="album-content-actions">
            <MediaViewControls
              view={mediaView}
              onChange={(view) => {
                stopPreviews();
                setMediaView(view);
              }}
            />
          </div>
        </div>
        {ms.length ? (
          <MediaLayoutGrid
            key={a.id}
            items={ms}
            view={mediaView}
            reducedMotion={db.settings.reducedMotion}
            onReflow={stopPreviews}
            render={(m) =>
              m && <MediaCard key={m.id} item={m} onOpen={() => open(m.id)} />
            }
          />
        ) : (
          <Empty
            title="这里还没有内容"
            text={
              page
                ? "编辑写真集，从已登记的媒体中添加照片或视频。"
                : "编辑写真集，从演示素材中添加照片或视频。"
            }
          />
        )}
        <ContinuousLoader />
      </div>
      {editing && (
        <AlbumEditor
          album={a}
          onClose={() => {
            setEditing(false);
            if (params.has("edit"))
              setParams((p) => {
                p.delete("edit");
                return p;
              }, { state: location.state });
          }}
        />
      )}
      {remove && (
        <Confirm
          title={page ? "移出图库？" : "移出演示库？"}
          text="只移除写真集及关联记录，不删除磁盘素材。"
          onClose={() => setRemove(false)}
          onConfirm={async () => {
            await act({ type: "removeAlbum", id: id! });
            nav(origin);
          }}
        />
      )}
    </>
  );
}
