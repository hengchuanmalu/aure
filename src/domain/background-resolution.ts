import { type ThumbnailEdge } from "@/domain/types";

/** Cover-crop pixels include screen density, zoom and the original's aspect ratio. */
export function backgroundResolution(
  width: number,
  height: number,
  density: number,
  zoom: number,
  imageRatio = 1,
): ThumbnailEdge {
  const longest =
    Math.max(
      width * Math.max(1, 1 / imageRatio),
      height * Math.max(1, imageRatio),
    ) *
    Math.max(1, density) *
    zoom;
  return longest <= 1024 ? 1024 : longest <= 2048 ? 2048 : 3072;
}
