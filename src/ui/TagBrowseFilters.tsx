import { catalog } from "@/domain/catalog";
import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { TagLabel } from "@/ui/TagLabel";
import { ChevronLeft,ChevronRight } from 'lucide-react';
import { useEffect,useMemo,useRef,useState } from 'react';

let scrollPosition = 0;

export function TagBrowseFilters({ value, onChange, model, onModelChange }: {
  value: string[]; onChange: (ids: string[]) => void;
  model: string; onModelChange: (id: string) => void;
}) {
  const { db, page } = useData();
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const selected = new Set(value);
  const counts = useMemo(() => {
    if (page) return page.tagAlbumCounts || {};
    const result: Record<string, number> = {};
    for (const summary of catalog(db).summaries.values()) {
      for (const id of summary.tags) result[id] = (result[id] || 0) + 1;
    }
    return result;
  }, [db, page]);
  useEffect(() => {
    const element = rail.current!;
    element.scrollLeft = scrollPosition;
    const measure = () => {
      scrollPosition = element.scrollLeft;
      setEdges({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); };
  }, [db.tags, db.models]);
  const scroll = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * .75, behavior: 'instant' });
  return <div className="tag-browse-filters" role="group" aria-label="标签筛选">
    <Button variant="ghost" className="tag-browse-all" aria-pressed={!value.length} onClick={() => onChange([])}><TagLabel>全部标签</TagLabel></Button>
    <div className="tag-browse-scroll" ref={rail}>
      <div className="tag-browse-track">
        {db.tags.map(tag => <Button variant="ghost" key={tag.id} className="tag-browse-chip" data-tag-id={tag.id}
          data-count={counts[tag.id] || 0} aria-label={tag.name} aria-description={`${counts[tag.id] || 0} 本写真；多个标签同时满足`}
          aria-pressed={selected.has(tag.id)} onClick={() => onChange(selected.has(tag.id) ? value.filter(id => id !== tag.id) : [...value, tag.id])}><TagLabel>{tag.name}</TagLabel></Button>)}
        {!db.tags.length && <span className="tag-browse-empty">还没有标签</span>}
        {db.models.length > 0 && <span className="tag-browse-divider" aria-hidden="true" />}
        {db.models.map(item => <Button variant="ghost" key={item.id} className="tag-browse-model" aria-label={`筛选模特 ${item.name}`}
          aria-pressed={model === item.id} onClick={() => onModelChange(model === item.id ? '' : item.id)}>
          <ModelAvatar model={item} /><span>{item.name}</span>
        </Button>)}
      </div>
    </div>
    <div className="tag-browse-arrows">
      {!edges.start && <Button variant="ghost" icon={<ChevronLeft />} aria-label="向前浏览筛选项" onClick={() => scroll(-1)} />}
      {!edges.end && <Button variant="ghost" icon={<ChevronRight />} aria-label="向后浏览筛选项" onClick={() => scroll(1)} />}
    </div>
  </div>;
}
