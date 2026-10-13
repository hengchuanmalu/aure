import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { avatarImageStyle } from "@/domain/avatar-crop";
import { countMedia } from "@/domain/media-count";
import { type Album } from "@/domain/types";
import { useData } from "@/state/data-context";
import { Button } from "@/ui/ActionButton";
import { AlbumFan } from "@/ui/AlbumFan";
import { Photo } from "@/ui/Photo";
import { Tags } from "@/ui/Tags";
import { Ellipsis, Heart } from "lucide-react";
import { useId, useState } from "react";
import { motion } from "motion/react";
import { useUiMotion } from "@/ui/useUiMotion";
import { Link, useLocation, useNavigate } from "react-router-dom";
export function AlbumCard({
  album: a,
  variant = "stack",
  featured = false,
  retainCover = false,
  coverRevision,
  highResolution = false,
  onCoverReady,
  onMenuOpenChange,
  transitionView = false,
}: {
  album: Album;
  variant?: "stack" | "cover";
  order?: number;
  featured?: boolean;
  retainCover?: boolean;
  coverRevision?: string;
  highResolution?: boolean;
  onCoverReady?: (ready: boolean) => void;
  onMenuOpenChange?: (open: boolean) => void;
  transitionView?: boolean;
}) {
  const { db, mutate, notice } = useData();
  const nav = useNavigate();
  const location = useLocation();
  const albumNavigationState = {
    albumOrigin: location.pathname + location.search,
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const captionId = useId();
  const { reduced, transitions } = useUiMotion();
  const titleMotion = {
    layoutId: transitionView && !reduced ? `${captionId}-title` : undefined,
    layout:
      transitionView && !reduced ? ("position" as const) : (false as const),
    transition: transitions.reflow,
    initial: false as const,
  };
  const countMotion = {
    ...titleMotion,
    layoutId: transitionView && !reduced ? `${captionId}-count` : undefined,
  };
  return (
    <article
      className={`album-card album-card--${variant}${transitionView ? " album-card--morph" : ""}`}
      data-menu-open={menuOpen}
    >
      <Link
        className="cover-link"
        to={`/album/${a.id}`}
        state={albumNavigationState}
        aria-label={`打开写真 ${a.name}`}
      >
        {variant === "stack" || transitionView ? (
          <>
            <AlbumFan
              album={a}
              highResolution={highResolution}
              variant={variant}
              transitionView={transitionView}
            />
            {variant === "stack" && (
              <div className="album-caption">
                <motion.h3 {...titleMotion}>{a.name}</motion.h3>
                <div className="card-bottom">
                  <motion.small {...countMotion}>
                    {countMedia(a, db)}
                  </motion.small>
                  {a.favorite && (
                    <Heart
                      className="caption-favorite"
                      fill="currentColor"
                      aria-label="已收藏"
                    />
                  )}
                </div>
                <Tags ids={a.tags.slice(0, 2)} interactive={false} />
              </div>
            )}
          </>
        ) : (
          <Photo
            src={a.cover}
            alt={a.name}
            style={a.coverCrop ? avatarImageStyle(a.coverCrop) : undefined}
            resolutionZoom={a.coverCrop?.zoom}
            retryable={false}
            priority={1}
            highResolution={highResolution}
            original={featured && !highResolution}
            retainOriginal={retainCover}
            originalRevision={coverRevision}
            onReady={onCoverReady}
          />
        )}
      </Link>
      <div className="album-overlay">
        {variant === "cover" && featured ? (
          <Link
            className="featured-caption"
            to={`/album/${a.id}`}
            state={albumNavigationState}
          >
            <h3>{a.name}</h3>
            <small>{countMedia(a, db)}</small>
          </Link>
        ) : (
          variant === "cover" && (
            <>
              <motion.h3 {...titleMotion}>{a.name}</motion.h3>
              <Tags ids={a.tags.slice(0, 2)} interactive={false} />
            </>
          )
        )}
        <div className="card-bottom">
          {variant === "cover" && !featured && (
            <motion.small {...countMotion}>{countMedia(a, db)}</motion.small>
          )}
          <Button
            variant="ghost"
            aria-label={`${a.favorite ? "取消收藏" : "收藏"} ${a.name}`}
            aria-pressed={a.favorite}
            icon={a.favorite ? <Heart fill="currentColor" /> : <Heart />}
            onClick={() =>
              void mutate((d) => {
                const album = d.albums.find((x) => x.id === a.id);
                if (!album) throw Error("写真集已不存在");
                album.favorite = !album.favorite;
              }).catch(() => notice("收藏保存失败，请重试"))
            }
          />
          <DropdownMenu
            modal={false}
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              onMenuOpenChange?.(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                aria-label={`${a.name} 更多操作`}
                icon={<Ellipsis />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  nav(`/album/${a.id}?edit=1`, { state: albumNavigationState })
                }
              >
                编辑写真集
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
