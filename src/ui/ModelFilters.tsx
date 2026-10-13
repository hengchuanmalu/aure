import { catalog } from "@/domain/catalog";
import { useData } from "@/state/data-context";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { useUiMotion } from "@/ui/useUiMotion";
import { LayoutGrid } from "lucide-react";
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

export function ModelFilters({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { db, page: catalogPage } = useData();
  const root = useRef<HTMLDivElement>(null);
  const { transitions } = useUiMotion();
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number }>();
  useLayoutEffect(() => {
    const element = root.current!;
    // Sticky viewport positions change during route scroll restoration. Measure
    // only local offsets so neither document nor horizontal scroll enters motion.
    const measure = () => {
      const selected = element.querySelector<HTMLElement>('[aria-pressed="true"]');
      setBounds(selected ? {
        x: selected.offsetLeft, y: selected.offsetTop,
        width: selected.offsetWidth, height: selected.offsetHeight,
      } : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value, db.models, catalogPage?.albumTotal, db.albums.length]);
  return (
      <div ref={root} className="model-filters" role="group" aria-label="按模特快速筛选">
        {bounds && <motion.span
          className="filter-indicator" aria-hidden="true" initial={false}
          animate={{ transform: `translate(${bounds.x}px, ${bounds.y}px)`, width: bounds.width, height: bounds.height }}
          transition={transitions.selection}
        />}
        <button
          className={`entity-chip ${!value ? "active" : ""}`}
          aria-pressed={!value}
          onClick={() => onChange("")}
        >
          <LayoutGrid size={16} />
          全部模特<span>{catalogPage?.albumTotal ?? db.albums.length}</span>
        </button>
        {db.models.map((m) => (
          <button
            key={m.id}
            className={`entity-chip ${value === m.id ? "active" : ""}`}
            aria-pressed={value === m.id}
            onClick={() => onChange(m.id)}
          >
            <ModelAvatar model={m} />
            <span className="entity-name">{m.name}</span>
            <span>
              {m.albumCount ?? catalog(db).modelCounts.get(m.id) ?? 0}
            </span>
          </button>
        ))}
      </div>
  );
}
