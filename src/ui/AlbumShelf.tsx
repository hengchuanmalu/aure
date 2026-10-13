import { AlbumCard } from '@/ui/AlbumCard';
import { type Album } from '@/domain/types';
import { Button } from "@/ui/ActionButton";
import { useUiMotion } from "@/ui/useUiMotion";
import { ChevronLeft,ChevronRight } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';

const GROUP_SIZE = 4;

function groupOffset(rail: HTMLElement, index: number) {
  const first = rail.children[0] as HTMLElement | undefined;
  const group = rail.children[index] as HTMLElement | undefined;
  return first && group ? group.offsetLeft - first.offsetLeft : 0;
}

export function AlbumShelf({ albums, link = '/library' }: { albums: Album[]; link?: string }) {
  const { reduced } = useUiMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const targetGroup = useRef(0);
  const [groupIndex, setGroupIndex] = useState(0);
  const groupCount = Math.ceil(albums.length / GROUP_SIZE);
  const currentGroup = Math.min(groupIndex, Math.max(groupCount - 1, 0));

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let timer: ReturnType<typeof setTimeout>;
    let width = rail.clientWidth;
    targetGroup.current = Math.min(targetGroup.current, Math.max(groupCount - 1, 0));
    setGroupIndex(targetGroup.current);
    rail.scrollTo({ left: groupOffset(rail, targetGroup.current), behavior: 'instant' });
    const settle = () => {
      clearTimeout(timer);
      let nearest = 0;
      for (let i = 1; i < groupCount; i++) {
        if (Math.abs(rail.scrollLeft - groupOffset(rail, i)) < Math.abs(rail.scrollLeft - groupOffset(rail, nearest))) nearest = i;
      }
      targetGroup.current = nearest;
      setGroupIndex(nearest);
    };
    // Also handle direct trackpad scrolling and browsers without scrollend.
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(settle, 150); };
    const observer = new ResizeObserver(() => {
      if (rail.clientWidth === width) return;
      width = rail.clientWidth;
      rail.scrollTo({ left: groupOffset(rail, targetGroup.current), behavior: 'instant' });
    });
    observer.observe(rail);
    rail.addEventListener('scroll', onScroll, { passive: true });
    rail.addEventListener('scrollend', settle);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      rail.removeEventListener('scroll', onScroll);
      rail.removeEventListener('scrollend', settle);
    };
  }, [groupCount]);

  const move = (direction: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const next = Math.max(0, Math.min(groupCount - 1, targetGroup.current + direction));
    targetGroup.current = next;
    setGroupIndex(next);
    // Same native smooth scrolling as the recent-update Rail; retain card nodes.
    rail.scrollTo({ left: groupOffset(rail, next), behavior: reduced ? 'instant' : 'smooth' });
  };
  if (!albums.length) return null;

  return (
    <section className="album-shelf" aria-label="图集展台" aria-roledescription="轮播">
      <div className="section-title">
        <h2>图集展台 <small>{albums.length} 本写真集</small></h2>
        <div className="row">
          <Link to={link} className="quiet-link">查看全部</Link>
          <Button variant="ghost" aria-label="上一组图集" icon={<ChevronLeft />} disabled={currentGroup === 0} onClick={() => move(-1)} />
          <Button variant="ghost" aria-label="下一组图集" icon={<ChevronRight />} disabled={currentGroup === groupCount - 1} onClick={() => move(1)} />
        </div>
      </div>
      <div className="rail shelf-rail" ref={railRef}>
        {Array.from({ length: groupCount }, (_, group) => (
          <div className="shelf-grid" key={group} inert={group !== currentGroup} aria-hidden={group !== currentGroup}>
            {albums.slice(group * GROUP_SIZE, (group + 1) * GROUP_SIZE).map((a, index) => (
              <AlbumCard key={a.id} album={a} order={index} highResolution />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
