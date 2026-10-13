import { Photo } from "@/ui/Photo";
import { avatarImageStyle } from "@/domain/avatar-crop";
import { albumMedia } from "@/domain/catalog";
import { countMedia } from "@/domain/media-count";
import { type Album } from "@/domain/types";
import { useData } from "@/state/data-context";
import { rememberSequence } from "@/state/viewer-sequence";
import { Button } from "@/ui/ActionButton";
import { ImageLightbox } from "@/ui/ImageLightbox";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { AlbumBrowseAction } from '@/ui/AlbumBrowseDock';
import { Heart, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

export function AlbumHero({
  album,
  onFavorite,
  contentStart,
}: {
  album: Album;
  onFavorite: () => void;
  contentStart: RefObject<HTMLDivElement | null>;
}) {
  const { db, page } = useData();
  const sequence = page ? [] : albumMedia(album, db).map((item) => item.id);
  const firstMediaId = page
    ? page.firstMediaId ?? album.mediaIds[0] ?? page.visibleMediaIds?.[0]
    : sequence[0];
  const nav = useNavigate();
  const location = useLocation();
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverAttempt, setCoverAttempt] = useState(0);
  const unavailable = useCallback(() => setCoverFailed(true), []);
  useEffect(() => {
    setCoverFailed(false);
  }, [album.cover]);
  const [coverAspectRatio, setCoverAspectRatio] = useState(1);
  const declaredMedia = [
    album.declaredPhotoCount !== undefined
      ? `${album.declaredPhotoCount}P`
      : "",
    album.declaredSize,
  ]
    .filter(Boolean)
    .join(" / ");
  return (
    // Layout is explicit rather than inferred from the bitmap: a future portrait
    // composition can reuse the metadata/actions without changing album storage.
    <section
      className="album-hero"
      data-cover-layout="landscape"
      aria-label="写真集封面"
    >
      <div className="album-hero-cover-panel">
        <button
          className="album-cover-trigger"
          aria-label="查看封面大图"
          disabled={!album.cover}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setCoverAspectRatio(bounds.width / bounds.height);
            setCoverOpen(true);
          }}
        >
          <Photo
            key={`${album.cover}:${coverAttempt}`}
            src={album.cover}
            alt={album.name}
            className="album-hero-cover"
            highResolution
            resolutionZoom={album.coverCrop?.zoom ?? 1}
            retryable={false}
            onUnavailable={unavailable}
            style={
              album.coverCrop ? avatarImageStyle(album.coverCrop) : undefined
            }
          />
        </button>
        {coverFailed && (
          <Button
            className="album-cover-retry"
            icon={<RotateCcw />}
            onClick={() => {
              setCoverFailed(false);
              setCoverAttempt((n) => n + 1);
            }}
          >
            重试
          </Button>
        )}
        <Button
          className="album-cover-favorite"
          icon={<Heart fill={album.favorite ? "currentColor" : "none"} />}
          variant="ghost"
          aria-label={album.favorite ? "取消收藏写真集" : "收藏写真集"}
          aria-pressed={album.favorite}
          onClick={onFavorite}
        />
      </div>
      <div className="album-hero-copy">
        <div className="album-hero-topline">
          <span className="content-label">{countMedia(album, db)}</span>
        </div>
        <h1>{album.name}</h1>
        <div className="album-hero-meta">
          {album.modelIds.length > 0 && (
            <div className="album-people">
              {album.modelIds.map((id) => {
                const model = db.models.find((m) => m.id === id);
                return (
                  model && (
                    <Link to={`/models/${id}`} key={id}>
                      <ModelAvatar model={model} />
                      {model.name}
                    </Link>
                  )
                );
              })}
            </div>
          )}
          {album.number && <span>编号 {album.number}</span>}
          {declaredMedia && <span>{declaredMedia}</span>}
          <span>{album.updatedAt} 更新</span>
        </div>
      </div>
      <div className="album-hero-actions">
        <AlbumBrowseAction
          contentStart={contentStart}
          disabled={!firstMediaId}
          onBrowse={() =>
            nav(`/viewer/${album.id}/${firstMediaId}`, {
              state: {
                backgroundLocation: location,
                from: `/album/${album.id}`,
                ...(page ? {} : { sequenceKey: rememberSequence(sequence) }),
              },
            })
          }
        />
      </div>
      {coverOpen && (
        <ImageLightbox
          src={album.cover}
          title={`${album.name} · 封面`}
          aspectRatio={coverAspectRatio}
          crop={album.coverCrop ?? { x: 50, y: 25, zoom: 1 }}
          onClose={() => setCoverOpen(false)}
        />
      )}
    </section>
  );
}
