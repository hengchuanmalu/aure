import { avatarImageStyle } from "@/domain/avatar-crop";
import { catalog } from "@/domain/catalog";
import { type Album } from "@/domain/types";
import { useData } from "@/state/data-context";
import { Photo } from "@/ui/Photo";
import { useAlbumCoverTransition } from "@/ui/useAlbumCoverTransition";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Only real media from this album form the fan. Videos use their poster. */
export function AlbumFan({
  album,
  className = "",
  highResolution = false,
  variant = "stack",
  transitionView = false,
}: {
  album: Album;
  className?: string;
  highResolution?: boolean;
  variant?: "stack" | "cover";
  transitionView?: boolean;
}) {
  const { db } = useData();
  const [retainPreviews, setRetainPreviews] = useState(variant === "stack");
  const [naturalRatio, setNaturalRatio] = useState({
    source: "",
    ratio: 1,
  });
  const fan = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const stackGeometry = useRef({ width: 0, height: 0, left: 0, top: 0 });
  useEffect(() => {
    if (variant === "stack") setRetainPreviews(true);
  }, [variant]);
  useLayoutEffect(() => {
    if (!transitionView || variant !== "stack") return;
    const element = fan.current!;
    const measure = () => {
      stackGeometry.current = {
        width: element.clientWidth,
        height: element.clientHeight,
        left: element.offsetLeft,
        top: element.offsetTop,
      };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [variant, transitionView]);
  const ratio = naturalRatio.source === album.cover ? naturalRatio.ratio : 1;
  const planeWidth = `max(100cqw, ${ratio * 100}cqh)`;
  const planeHeight = `max(100cqh, ${100 / ratio}cqw)`;
  const cropX = (album.coverCrop?.x ?? 50) / 100;
  const cropY = (album.coverCrop?.y ?? 35) / 100;
  useAlbumCoverTransition(
    frame,
    plane,
    variant,
    transitionView,
    ratio,
    cropX,
    cropY,
  );
  const photo = (
    <Photo
      src={album.cover}
      alt={album.name}
      style={album.coverCrop ? avatarImageStyle(album.coverCrop) : undefined}
      resolutionZoom={album.coverCrop?.zoom}
      retryable={false}
      priority={1}
      highResolution={highResolution}
      onReady={
        transitionView
          ? (ready) => {
              const image = front.current?.querySelector("img");
              if (!ready || !image?.naturalHeight) return;
              const ratio = image.naturalWidth / image.naturalHeight;
              setNaturalRatio((old) =>
                old.source === album.cover && old.ratio === ratio
                  ? old
                  : { source: album.cover, ratio },
              );
            }
          : undefined
      }
    />
  );
  const previews =
    variant === "stack" || retainPreviews
      ? catalog(db).summaries.get(album.id)?.previews || []
      : [];

  return (
    <div
      ref={fan}
      className={`album-fan ${transitionView ? "album-fan--morph" : ""} ${className}`}
      data-preview-count={previews.length}
    >
      {previews.map((src, index) => (
        <div
          className={`fan-leaf leaf-${index}`}
          key={src}
          aria-hidden="true"
          style={
            transitionView && variant === "cover" && stackGeometry.current.width
              ? {
                  width: stackGeometry.current.width * 0.56,
                  height: stackGeometry.current.height * 0.92,
                  left:
                    stackGeometry.current.left +
                    stackGeometry.current.width * 0.22,
                  top:
                    stackGeometry.current.top +
                    stackGeometry.current.height * 0.04,
                }
              : undefined
          }
        >
          <Photo
            src={src}
            retryable={false}
            priority={-1}
            highResolution={highResolution}
          />
        </div>
      ))}
      <div className="fan-front-layout" ref={frame}>
        <div className="fan-front" ref={front}>
          {transitionView ? (
            <div
              className="fan-photo-plane"
              ref={plane}
              style={{
                width: planeWidth,
                height: planeHeight,
                left: `calc((100cqw - ${planeWidth}) * ${cropX})`,
                top: `calc((100cqh - ${planeHeight}) * ${cropY})`,
              }}
            >
              {photo}
            </div>
          ) : (
            photo
          )}
        </div>
      </div>
    </div>
  );
}
