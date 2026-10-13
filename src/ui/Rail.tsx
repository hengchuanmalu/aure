import { Button } from "@/ui/ActionButton";
import { useUiMotion } from "@/ui/useUiMotion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
export function Rail({
  title,
  children,
  link,
  hideScrollbar = false,
}: {
  title: string;
  children: ReactNode;
  link?: string;
  hideScrollbar?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useUiMotion();
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    const measure = () =>
      setEdges({
        start: rail.scrollLeft <= 1,
        end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);
    rail.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", measure);
    };
  }, [children]);
  const scroll = (direction: number) => {
    ref.current?.scrollBy({
      left: direction * ref.current.clientWidth * 0.85,
      behavior: reduced ? "instant" : "smooth",
    });
  };
  return (
    <section className="rail-section">
      <div className="section-title">
        <h2>{title}</h2>
        <div className="row">
          {link && (
            <Link className="quiet-link" to={link}>
              查看全部
            </Link>
          )}
          <Button
            variant="ghost"
            aria-label={`${title} 向左滚动`}
            disabled={edges.start}
            icon={<ChevronLeft />}
            onClick={() => scroll(-1)}
          />
          <Button
            variant="ghost"
            aria-label={`${title} 向右滚动`}
            disabled={edges.end}
            icon={<ChevronRight />}
            onClick={() => scroll(1)}
          />
        </div>
      </div>
      <div
        className={`rail${hideScrollbar ? " rail-scrollbar-hidden" : ""}`}
        ref={ref}
      >
        {children}
      </div>
    </section>
  );
}
