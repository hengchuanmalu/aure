import { backgroundCrop,backgroundImageStyle } from "@/domain/background-crop";
import { type ModelProfile } from '@/domain/types';
import { Photo } from "@/ui/Photo";
import { useBackgroundResolution } from "@/ui/useBackgroundResolution";
import { useRef } from 'react';

export function ModelBackground({ model, className = '', sourcePath }: { model: ModelProfile; className?: string; sourcePath?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const crop = backgroundCrop(model);
  const edge = useBackgroundResolution(container, model.background, crop.zoom);
  return <div className={`model-background ${className}`} ref={container}>
    {model.background && <Photo src={model.background} sourcePath={sourcePath} thumbnailEdge={edge} style={backgroundImageStyle(crop)} />}
  </div>;
}
