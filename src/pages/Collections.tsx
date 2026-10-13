import { AlbumCard } from '@/ui/AlbumCard';
import { AlbumViewSwitch } from '@/ui/AlbumViewSwitch';
import { Empty } from '@/ui/Empty';
import { MediaCard } from '@/ui/MediaCard';
import { catalog } from "@/domain/catalog";
import { type Album } from '@/domain/types';
import { useData } from '@/state/data-context';
import { rememberSequence } from "@/state/viewer-sequence";
import { ContinuousLoader } from "@/ui/ContinuousLoader";
import { VirtualGrid } from "@/ui/VirtualGrid";
import { useLocation,useNavigate,useSearchParams } from "react-router-dom";

export default function Collections({ recent = false }: { recent?: boolean }) {
  const { db, page } = useData();
  const nav = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'media' ? 'media' : 'albums';
  const view = params.get('view') === 'cover' ? 'cover' : 'stack';
  const setTab = (value: string) => setParams(p => { p.set('tab', value); p.delete('page'); return p; });
  // Native snapshots are already filtered and ordered. Reinterpreting the old
  // window using the destination route can empty it before its query completes.
  const albums = page ? db.albums : recent
    ? db.recent
        .map((r) => db.albums.find((a) => a.id === r.albumId))
        .filter((a): a is Album => !!a)
    : db.albums.filter((a) => a.favorite);
  const media = page ? (page.visibleMediaIds || []).flatMap(id => { const m = catalog(db).media.byId.get(id); return m ? [m] : []; }) : db.media.filter((m) => m.favorite);
  return (
    <div className="page-pad">
      <div className="page-heading">
        <div>
          <h1>{recent ? "最近浏览" : "收藏"}</h1>
        </div>
        {(recent || tab === 'albums') && (
          <AlbumViewSwitch
            value={view}
            onChange={value => setParams(previous => {
              const next = new URLSearchParams(previous);
              if (value === 'cover') next.set('view', 'cover');
              else next.delete('view');
              return next;
            })}
          />
        )}
      </div>
      {!recent && (
        <div className="tabs">
          <button
            className={tab === "albums" ? "active" : ""}
            aria-pressed={tab === "albums"}
            onClick={() => setTab("albums")}
          >
            写真集 · {page?.total ?? albums.length}
          </button>
          <button
            className={tab === "media" ? "active" : ""}
            aria-pressed={tab === "media"}
            onClick={() => setTab("media")}
          >
            照片与视频 · {page?.mediaTotal ?? media.length}
          </button>
        </div>
      )}
      {tab === "albums" || recent ? (
        albums.length ? (
          <VirtualGrid
            className={`album-grid${view === 'cover' ? ' cover-grid' : ''}`}
            transitionKey={view}
            items={albums}
            render={a => <AlbumCard key={a.id} album={a} variant={view} transitionView />}
          />
        ) : (
          <Empty title={recent ? "还没有浏览记录" : "还没有收藏的写真"} />
        )
      ) : media.length ? (
        <VirtualGrid className="media-grid" items={media} render={(m) => (
            <MediaCard
              key={m.id}
              item={m}
              onOpen={() =>
                nav(`/viewer/favorites/${m.id}`, {
                  state: {
                    backgroundLocation: location,
                    from: location.pathname + location.search,
                    ...(page ? {} : { sequenceKey: rememberSequence(media.map((m) => m.id)) }),
                  },
                })
              }
            />
          )} />
      ) : (
        <Empty title="还没有收藏的照片或视频" />
      )}
      {!recent && <ContinuousLoader media={tab === 'media'} />}
    </div>
  );
}
