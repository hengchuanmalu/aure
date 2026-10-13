import { avatarCrop,avatarImageStyle } from "@/domain/avatar-crop";
import { type ModelProfile } from '@/domain/types';
import { Photo } from "@/ui/Photo";

export function ModelAvatar({ model, className = '', sourcePath }: {
  model: ModelProfile; className?: string; sourcePath?: string;
}) {
  return <span className={`model-avatar ${className}`}>
    <Photo src={model.avatar} sourcePath={sourcePath} retryable={false} highResolution resolutionZoom={avatarCrop(model).zoom} style={avatarImageStyle(avatarCrop(model))} />
  </span>;
}
