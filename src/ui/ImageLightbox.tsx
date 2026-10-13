import { Dialog,DialogContent,DialogTitle } from "@/components/ui/dialog";
import { avatarImageStyle,type AvatarCrop } from "@/domain/avatar-crop";
import { Photo } from "@/ui/Photo";
import { useRef,type CSSProperties } from 'react';

export function ImageLightbox({ src, title, crop, aspectRatio = 1, circular = false, onClose }: {
  src: string; title: string; crop?: AvatarCrop; aspectRatio?: number; circular?: boolean; onClose: () => void;
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="image-lightbox" aria-describedby={undefined} showCloseButton={false}
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <div className={`image-lightbox-crop${circular ? ' image-lightbox-circle' : ''}`}
        style={{ '--lightbox-aspect': circular ? 1 : aspectRatio } as CSSProperties}>
        <Photo src={src} original alt={title} style={crop ? avatarImageStyle(crop) : undefined} />
      </div>
    </DialogContent>
  </Dialog>;
}
