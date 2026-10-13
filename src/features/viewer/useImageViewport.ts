import { useEffect, useRef, useState } from "react";

export function useImageViewport(mediaId: string | undefined) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nativeSize, setNativeSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState({
    width: innerWidth,
    height: innerHeight,
  });
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<
    { x: number; y: number; px: number; py: number } | undefined
  >(undefined);
  const [dragging, setDragging] = useState(false);
  const fit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const actual = () => {
    const scale = Math.min(
      frame.width / (nativeSize.width || 1),
      frame.height / (nativeSize.height || 1),
    );
    setZoom(1 / scale);
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const size = () =>
      setFrame({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(size);
    observer.observe(element);
    size();
    return () => observer.disconnect();
  }, [mediaId]);
  return {
    zoom,
    setZoom,
    pan,
    setPan,
    nativeSize,
    setNativeSize,
    stage,
    image,
    drag,
    dragging,
    setDragging,
    fit,
    actual,
  };
}
