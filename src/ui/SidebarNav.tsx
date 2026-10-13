import { useData } from '@/state/data-context';
import { Heart,History,House,Images,Settings,Tags,UsersRound } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { useEffect,useId,useRef,useState,type PointerEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { useUiMotion } from '@/ui/useUiMotion';

export const navigation = [
  ['/', '发现', House], ['/library', '写真库', Images], ['/models', '模特', UsersRound],
  ['/tags', '标签', Tags],
  ['/favorites', '收藏', Heart], ['/recent', '最近浏览', History], ['/settings', '设置', Settings],
] as const;
const defaultOrder = navigation.map(([path]) => path as string);
function normalize(order?: string[]) {
  const result = [...new Set(order || defaultOrder)].filter(path => defaultOrder.includes(path));
  for (const path of defaultOrder) {
    if (!result.includes(path)) result.splice(result.includes('/settings') ? result.indexOf('/settings') : result.length, 0, path);
  }
  return result;
}

export function SidebarNav() {
  const { db, mutate, notice } = useData();
  const groupId = useId();
  const { reduced, transitions } = useUiMotion();
  const [draft, setDraft] = useState<string[]>();
  const [dragging, setDragging] = useState('');
  const order = draft || normalize(db.settings.sidebarOrder);
  const gesture = useRef<{ path: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; active: boolean; order: string[] } | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => () => { if (gesture.current) clearTimeout(gesture.current.timer); }, []);
  const persist = async (next: string[]) => {
    try { await mutate(d => { d.settings.sidebarOrder = next; }); }
    catch { notice('导航顺序保存失败，请重试'); }
    finally { setDraft(undefined); }
  };
  const finish = (cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    clearTimeout(current.timer);
    gesture.current = undefined;
    setDragging('');
    if (current.active) {
      suppressClick.current = true;
      if (!cancel) void persist(current.order);
      else setDraft(undefined);
    }
  };
  const move = (e: PointerEvent) => {
    const current = gesture.current;
    if (!current) return;
    if (!current.active) {
      if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > 8) finish(true);
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-nav-path]')?.dataset.navPath;
    if (!target || target === current.path) return;
    const next = [...current.order];
    next.splice(next.indexOf(current.path), 1);
    next.splice(current.order.indexOf(target), 0, current.path);
    current.order = next;
    setDraft(next);
  };
  return <LayoutGroup id={groupId}><nav aria-label="主导航" className="sidebar-nav" data-dragging={!!dragging}
    onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}>
    {order.map(path => {
      const [, title, Icon] = navigation.find(item => item[0] === path)!;
      return <NavLink key={path} to={path} end={path === '/'} data-nav-path={path}
        className={`${dragging === path ? 'nav-dragging' : ''} ${path === '/settings' && order.at(-1) === path ? 'nav-settings-last' : ''}`}
        draggable={false} aria-label={title} aria-describedby="nav-reorder-help"
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          if (e.button !== 0) return;
          suppressClick.current = false;
          finish(true);
          const element = e.currentTarget;
          const current = { path, x: e.clientX, y: e.clientY, active: false, order: [...order], timer: setTimeout(() => {
            current.active = true;
            suppressClick.current = true;
            element.setPointerCapture(e.pointerId);
            setDragging(path);
          }, 400) };
          gesture.current = current;
        }}
        onPointerLeave={() => { if (gesture.current && !gesture.current.active) finish(true); }}
        onLostPointerCapture={() => finish(true)}
        onClick={e => { if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; } }}
        onKeyDown={e => {
          if (e.key === 'Escape') { finish(true); return; }
          if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const from = order.indexOf(path), to = from + (e.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= order.length) return;
          const next = [...order];
          [next[from], next[to]] = [next[to], next[from]];
          setDraft(next);
          void persist(next);
        }}>
        {({ isActive }) => <>
          {isActive && <motion.span
            className="sidebar-selection" aria-hidden="true" initial={false}
            layoutId={reduced || dragging ? undefined : 'selected'}
            transition={transitions.selection}
          />}
          <Icon aria-hidden="true" /><span>{title}</span>
        </>}
      </NavLink>;
    })}
    <span className="sr-only" id="nav-reorder-help">长按后拖动调整顺序，或按 Alt 加上下方向键调整。</span>
  </nav></LayoutGroup>;
}
