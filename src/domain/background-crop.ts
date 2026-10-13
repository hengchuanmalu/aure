import { avatarImageStyle, clamp, type AvatarCrop } from "@/domain/avatar-crop";
import { type ModelProfile } from "@/domain/types";

export function backgroundCrop(
  model: Pick<ModelProfile, "backgroundCrop" | "backgroundFocus">,
): AvatarCrop {
  const finite = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    x: clamp(finite(model.backgroundCrop?.x, 50), 0, 100),
    y: clamp(
      finite(model.backgroundCrop?.y, finite(model.backgroundFocus, 50)),
      0,
      100,
    ),
    zoom: clamp(finite(model.backgroundCrop?.zoom, 1), 1, 3),
  };
}
export const backgroundImageStyle = avatarImageStyle;
