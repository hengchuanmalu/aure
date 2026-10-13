import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SortDirection } from "@/domain/album-sort";
import { ArrowUp,ChevronDown } from 'lucide-react';
import { useLayoutEffect,useState } from 'react';

export function SortField<T extends string>({ value, direction, options, onChange }: {
  value: T;
  direction: SortDirection;
  options: { value: T; label: string; defaultDirection: SortDirection }[];
  onChange: (value: T, direction: SortDirection) => void;
}) {
  const selected = options.find(option => option.value === value)!;
  const [rotation, setRotation] = useState(() => direction === 'asc' ? 0 : 180);
  useLayoutEffect(() => {
    // Each flip advances clockwise, including repeated and rapid toggles.
    setRotation(angle => (angle / 180) % 2 === (direction === 'asc' ? 0 : 1) ? angle : angle + 180);
  }, [direction]);
  return <DropdownMenu>
    <DropdownMenuTrigger className="select-field" aria-label="排序"
      aria-description={`${selected.label}，${direction === 'asc' ? '正序' : '降序'}`}>
      <span>{selected.label}</span><ChevronDown aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="sort-menu" align="end" sideOffset={6} collisionPadding={12} aria-labelledby={undefined} aria-label="排序选项">
        {options.map(option => <DropdownMenuItem key={option.value} className="sort-option"
          role="menuitemradio" aria-checked={value === option.value}
          aria-description={value === option.value ? `${direction === 'asc' ? '升序' : '降序'}，点击切换` : undefined}
          onSelect={event => {
            event.preventDefault();
            const active = value === option.value;
            onChange(option.value, active ? direction === 'asc' ? 'desc' : 'asc' : option.defaultDirection);
          }}>
            <span>{option.label}</span>
            {value === option.value && <span className="sort-arrow" data-direction={direction}
              style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true"><ArrowUp /></span>}
          </DropdownMenuItem>
        )}
    </DropdownMenuContent>
  </DropdownMenu>;
}
