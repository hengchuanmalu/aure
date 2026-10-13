import { backgroundResolution } from "@/domain/background-resolution";
import { type ThumbnailEdge } from '@/domain/types';
import { useEffect,useState,type RefObject } from 'react';

export function useBackgroundResolution(container: RefObject<HTMLElement | null>, source: string, zoom: number) {
  const [edge, setEdge] = useState<ThumbnailEdge>(1024);
  useEffect(() => {
    const element = container.current;
    if (!element || !source) return;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
        const ratio = image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
        setEdge(backgroundResolution(element.clientWidth, element.clientHeight, window.devicePixelRatio, zoom, ratio));
      }, 180);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('load', measure, true);
    window.addEventListener('resize', measure);
    measure();
    return () => { clearTimeout(timer); observer.disconnect(); element.removeEventListener('load', measure, true); window.removeEventListener('resize', measure); };
  }, [container, source, zoom]);
  return edge;
}
