import { originalCoverCache } from "@/infrastructure/original-cover-cache";
import { desktop } from '@/infrastructure/tauri-bridge';
import { readCoverRevision } from '@/infrastructure/desktop-repository';
import { useLayoutEffect,useRef } from 'react';

export function RetainedOriginalPhoto({ src, revision, alt, className, style, onError, onReady }: {
  src: string; revision?: string; alt: string; className: string; style?: React.CSSProperties; onError: () => void; onReady?: (ready: boolean) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement | undefined>(undefined);
  const props = useRef({ alt, style, onError, onReady });
  props.current = { alt, style, onError, onReady };
  useLayoutEffect(() => {
    let disposed = false;
    let held: HTMLImageElement | undefined;
    let key = src;
    const failed = () => { if (!disposed) { if (host.current) host.current.dataset.photoState = 'error'; props.current.onError(); } };
    const ready = () => {
      if (!held?.naturalWidth) return;
      void held.decode().catch(() => {}).then(() => {
        if (!disposed && held?.naturalWidth && host.current) {
          host.current.dataset.photoState = 'ready';
          host.current.removeAttribute('role');
          host.current.removeAttribute('aria-label');
          props.current.onReady?.(true);
        }
      });
    };
    props.current.onReady?.(false);
    const attach = async () => {
      let url = src;
      if (desktop() && src.startsWith('http://jingji.localhost/media/')) {
        const id = decodeURIComponent(new URL(src).pathname.slice('/media/'.length));
        const checkedRevision = revision || await readCoverRevision(id);
        key += ':' + checkedRevision;
        const versioned = new URL(src);
        versioned.searchParams.set('v', checkedRevision);
        url = versioned.href;
      }
      if (disposed || !host.current) return;
      held = originalCoverCache.take(key);
      image.current = held;
      held.alt = props.current.alt;
      held.className = 'photo-image';
      Object.assign(held.style, props.current.style);
      held.loading = 'eager';
      held.decoding = 'async';
      held.fetchPriority = 'high';
      held.draggable = false;
      held.addEventListener('error', failed);
      held.addEventListener('load', ready);
      // Changing src would throw away the retained image's decoded surface.
      if (held.getAttribute('src') !== url) held.src = url;
      host.current.append(held);
      if (held.complete) ready();
    };
    void attach().catch(failed);
    return () => {
      disposed = true;
      if (held) {
        held.removeEventListener('error', failed);
        held.removeEventListener('load', ready);
        originalCoverCache.release(key, held);
      }
      image.current = undefined;
    };
  }, [src, revision]);
  useLayoutEffect(() => {
    if (image.current) { image.current.alt = alt; image.current.removeAttribute('style'); Object.assign(image.current.style, style); }
  }, [alt, style]);
  return <span className={`retained-original-photo photo-frame ${className}`} ref={host} data-photo-state="loading" role="img" aria-label={alt || '图片加载中'} />;
}
