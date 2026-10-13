import { type ModelProfile } from "@/domain/types";

export type AvatarCrop = { x: number; y: number; zoom: number };
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function avatarCrop(
  model: Pick<ModelProfile, "avatarFocus" | "avatarCrop">,
): AvatarCrop {
  return {
    x: clamp(model.avatarCrop?.x ?? 50, 0, 100),
    y: clamp(model.avatarCrop?.y ?? model.avatarFocus, 0, 100),
    zoom: clamp(model.avatarCrop?.zoom ?? 1, 1, 3),
  };
}
export function avatarImageStyle(crop: AvatarCrop) {
  const position = `${crop.x}% ${crop.y}%`;
  return {
    objectPosition: position,
    transformOrigin: position,
    transform: `scale(${crop.zoom})`,
  };
}
