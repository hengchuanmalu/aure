import { loadModelCoverPreview } from "@/infrastructure/model-cover-preview";
import { avatarImageStyle } from "@/domain/avatar-crop";
import type { Album, ModelProfile } from "@/domain/types";
import { useData } from "@/state/data-context";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { ModelCard } from "@/ui/ModelCard";
import { Photo } from "@/ui/Photo";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";

export function ModelCoverPreview({
  model,
  open,
  slots,
  onTrigger,
  onResolved,
}: {
  model: ModelProfile;
  open: boolean;
  slots: number;
  onTrigger: (node: HTMLElement, event?: PointerEvent<HTMLElement>) => void;
  onResolved: (count: number) => void;
}) {
  const { db, page } = useData();
  const location = useLocation();
  const [result, setResult] = useState<{ albums: Album[]; error?: boolean }>();
  const latest = useRef({ db, remote: !!page, onResolved });
  latest.current = { db, remote: !!page, onResolved };
  useEffect(() => {
    if (!open) {
      setResult(undefined);
      return;
    }
    let active = true;
    setResult(undefined);
    const { db, remote } = latest.current;
    void loadModelCoverPreview(model.id, db, remote).then(
      (albums) => {
        if (!active) return;
        setResult({ albums });
        latest.current.onResolved(albums.length);
      },
      () => {
        if (active) setResult({ albums: [], error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [open, model.id]);
  const trigger = (event: PointerEvent<HTMLSpanElement>) =>
    onTrigger(event.currentTarget, event);
  return (
    <div
      className="model-preview-group"
      data-expanded={open}
      data-model-preview-id={model.id}
      onFocusCapture={(event) => {
        if (event.target.matches(".model-card:focus-visible"))
          onTrigger(event.target);
      }}
    >
      <ModelCard
        model={model}
        avatar={
          <span
            className="model-cover-preview-trigger"
            onPointerEnter={trigger}
            onPointerMove={trigger}
          >
            <ModelAvatar model={model} />
          </span>
        }
      />
      {open && (
        <div
          className="model-cover-preview"
          aria-label={`${model.name}的随机写真封面`}
          aria-busy={!result}
        >
          <div
            className="model-cover-preview-images"
            style={{
              gridTemplateColumns: `repeat(${slots}, minmax(0, 112px))`,
            }}
          >
            {!result
              ? Array.from({ length: slots }, (_, index) => (
                  <span
                    key={index}
                    className="model-cover-preview-placeholder"
                    aria-hidden="true"
                  />
                ))
              : result.albums.map((album) => (
                  <Link
                    key={album.id}
                    to={`/album/${album.id}`}
                    state={{ albumOrigin: location.pathname + location.search }}
                    className="model-cover-preview-link"
                    aria-label={`打开写真：${album.name}`}
                  >
                    <Photo
                      src={album.cover}
                      alt={album.name}
                      retryable={false}
                      className="model-cover-preview-image"
                      style={
                        album.coverCrop
                          ? avatarImageStyle(album.coverCrop)
                          : undefined
                      }
                    />
                  </Link>
                ))}
          </div>
          {!result && (
            <span className="sr-only" role="status">
              加载封面…
            </span>
          )}
          {result?.error && (
            <span className="model-cover-preview-status" role="status">
              封面暂时无法加载
            </span>
          )}
        </div>
      )}
    </div>
  );
}
