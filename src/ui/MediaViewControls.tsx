import {
defaultMediaView,
mediaViewStorageKey,
parseMediaView,
type MediaView,
} from "@/domain/media-layout";
import { Button } from "@/ui/ActionButton";
import { Columns3,GalleryHorizontal,Grid2X2 } from "lucide-react";
import { useState } from "react";

export function useMediaView() {
  const [view, setView] = useState<MediaView>(() => {
    try {
      return parseMediaView(
        JSON.parse(localStorage.getItem(mediaViewStorageKey) || "null"),
      );
    } catch {
      return defaultMediaView;
    }
  });
  return [
    view,
    (next: MediaView) => {
      const safe = parseMediaView(next);
      setView(safe);
      try {
        localStorage.setItem(mediaViewStorageKey, JSON.stringify(safe));
      } catch {
        /* The current view remains usable when preference storage is unavailable. */
      }
    },
  ] as const;
}

export function MediaViewControls({
  view,
  onChange,
}: {
  view: MediaView;
  onChange: (next: MediaView) => void;
}) {
  return (
    <div className="media-view-controls">
      <label className="media-column-control">
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={view.columns}
          aria-label="每行照片数"
          aria-valuetext={`每行 ${view.columns} 张`}
          onChange={(event) =>
            onChange({ ...view, columns: Number(event.target.value) })
          }
        />
      </label>
      <div
        className="media-mode-control"
        role="group"
        aria-label="照片展示视图"
      >
        {(
          [
            ["masonry", "瀑布流", Columns3],
            ["tiles", "平铺", Grid2X2],
            ["adaptive", "自适应", GalleryHorizontal],
          ] as const
        ).map(([mode, label, Icon]) => (
          <Button
            key={mode}
            hint={label}
            variant="ghost"
            size="icon-sm"
            icon={<Icon />}
            aria-label={`${label}视图`}
            aria-pressed={view.mode === mode}
            onClick={() => onChange({ ...view, mode })}
          />
        ))}
      </div>
    </div>
  );
}
