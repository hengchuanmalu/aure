import { useData } from '@/state/data-context';
import { Button } from "@/ui/ActionButton";
import { CatalogSearch } from "@/ui/CatalogSearch";
import { SidebarNav,navigation } from "@/ui/SidebarNav";
import { AlbumBrowseDockContext } from '@/ui/AlbumBrowseDock';
import { Pencil,Plus,Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { lazy,Suspense,useEffect,useLayoutEffect,useRef,useState } from "react";
import {
Link,
Outlet,
useLocation,
useMatch,
useNavigate,
} from "react-router-dom";

const positions = new Map<string, number>();
const ModelEditor = lazy(() => import('@/features/models/ModelEditor').then(module => ({ default: module.ModelEditor })));
const TagEditorDialog = lazy(() => import('@/ui/TagEditorDialog').then(module => ({ default: module.TagEditorDialog })));

export function Shell() {
  const { db, recordRecent } = useData();
  const nav = useNavigate();
  const loc = useLocation();
  const modelDetail = useMatch('/models/:id');
  const albumDetail = useMatch('/album/:id');
  const scrollParams = new URLSearchParams(loc.search);
  // Presentation changes share one browsing position; the grid owns reflow anchoring.
  if (modelDetail || ['/library', '/tags', '/favorites', '/recent'].includes(loc.pathname))
    scrollParams.delete('view');
  const scrollKey = loc.pathname + (scrollParams.size ? `?${scrollParams}` : '');
  const detailAlbum = albumDetail ? db.albums.find(album => album.id === albumDetail.params.id) : undefined;
  const detailModel = modelDetail ? db.models.find(model => model.id === modelDetail.params.id) : undefined;
  const [editingModel, setEditingModel] = useState(false);
  useEffect(() => setEditingModel(false), [loc.pathname]);
  const recentView = loc.pathname === '/recent';
  const tagsArea = loc.pathname === '/tags' || loc.pathname.startsWith('/tags/');
  const [tagDraft, setTagDraft] = useState<{ groupId?: string } | undefined>(() => tagsArea && new URLSearchParams(loc.search).get('create') === 'tag' ? {} : undefined);
  useEffect(() => {
    if (tagsArea && new URLSearchParams(loc.search).get('create') === 'tag') setTagDraft(current => current || {});
  }, [tagsArea, loc.search]);
  const closeTag = () => {
    setTagDraft(undefined);
    const params = new URLSearchParams(loc.search);
    if (params.get('create') === 'tag') { params.delete('create'); nav(`${loc.pathname}${params.size ? `?${params}` : ''}`, { replace: true }); }
  };
  const isModelsPage = loc.pathname === "/models" || loc.pathname.startsWith("/models/");
  const main = useRef<HTMLElement>(null);
  const browseTarget = useRef<HTMLSpanElement>(null);
  const editAction = useRef<HTMLButtonElement>(null);
  const [browseHost, setBrowseHost] = useState<HTMLDivElement | null>(null);
  const [browseDocked, setBrowseDocked] = useState(false);
  const current =
    navigation.find(([path]) =>
      path === "/" ? loc.pathname === "/" : loc.pathname.startsWith(path),
    )?.[1] ||
    (loc.pathname.startsWith("/album")
      ? "写真集"
      : loc.pathname.startsWith("/settings") || loc.pathname === '/tags'
        ? "设置"
        : "aure");
  useLayoutEffect(() => {
    const key = scrollKey;
    const target = positions.get(key) || 0;
    let lastY = target;
    let frame = 0;
    const remember = () => { lastY = window.scrollY; };
    window.addEventListener('scroll', remember, { passive: true });
    window.scrollTo(0, target);
    // Wait for a stable extent rather than restoring against a too-short initial estimate.
    // Any user interaction immediately takes over; the bounded retry never traps scrolling.
    let attempts = 0, stable = 0, previousHeight = 0;
    const cancelRestore = () => cancelAnimationFrame(frame);
    const restore = () => {
      const height = document.documentElement.scrollHeight;
      window.scrollTo(0, target);
      stable = Math.abs(window.scrollY - target) < 1 && height === previousHeight ? stable + 1 : 0;
      previousHeight = height;
      if (stable < 3 && ++attempts < 30) frame = requestAnimationFrame(restore);
    };
    if (target > 0) frame = requestAnimationFrame(restore);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, cancelRestore, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.removeEventListener(event, cancelRestore);
      window.removeEventListener('scroll', remember);
      // The DOM may already have collapsed during unmount; use the last observed position.
      positions.delete(key);
      positions.set(key, lastY);
      while (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
  }, [scrollKey]);
  return (
    <AlbumBrowseDockContext.Provider value={{ target: browseTarget, edit: editAction, host: browseHost, setDocked: setBrowseDocked }}>
    <div className={albumDetail ? 'shell shell--album' : 'shell'}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        跳到内容
      </a>
      {/* Fixed viewport coordinates must not include route scroll restoration. */}
      <motion.aside className="sidebar" layoutRoot layoutScroll>
        <Link to="/" className="brand" aria-label="aure首页">
          <img src="/brand.png" alt="" />
          <b>aure</b>
        </Link>
        <SidebarNav />
      </motion.aside>
      <div className="main-column">
        <header className="topbar">
          <div className="location-label">
            aure<span>/</span>
            <strong>{current}</strong>
          </div>
          <CatalogSearch />
          <div className="topbar-action-group" data-browse-docked={!!albumDetail && browseDocked}>
          {albumDetail && <span ref={browseTarget} className="album-browse-target" aria-hidden="true" />}
          <Button
            ref={editAction}
            className={recentView ? 'recent-clear-action' : undefined}
            variant={recentView ? 'secondary' : 'default'}
            icon={modelDetail || albumDetail ? <Pencil /> : recentView ? <Trash2 /> : <Plus />}
            disabled={(!!modelDetail && !detailModel) || (!!albumDetail && !detailAlbum)}
            onClick={() => {
              if (albumDetail) {
                const params = new URLSearchParams(loc.search);
                params.set('edit', '1');
                nav(`${loc.pathname}?${params}`, { replace: true, state: loc.state });
              } else if (modelDetail) setEditingModel(true);
              else if (recentView) void recordRecent();
              else if (tagsArea) setTagDraft({});
              else nav(isModelsPage ? "/models?create=1" : "/library?create=1");
            }}
          >
            {albumDetail ? '编辑写真集' : modelDetail ? '编辑资料' : recentView ? '清除浏览记录' : tagsArea ? '添加标签' : isModelsPage ? "添加模特" : "添加写真"}
          </Button>
          </div>
        </header>
        <main
          className={`page-content${loc.pathname === "/settings" ? " page-content--settings" : ""}`}
          id="main-content"
          ref={main}
          tabIndex={-1}
        >
          <div>
            <Outlet context={{ openTagDialog: (options: { groupId?: string } = {}) => setTagDraft(options) }} />
          </div>
        </main>
      </div>
      <div ref={setBrowseHost} className="album-browse-layer" />
      <Suspense fallback={<span role="status">正在加载编辑器…</span>}>
        {tagDraft && <TagEditorDialog groupId={tagDraft.groupId} onClose={closeTag} />}
        {editingModel && detailModel && <ModelEditor model={detailModel} onClose={() => setEditingModel(false)} />}
      </Suspense>
    </div>
    </AlbumBrowseDockContext.Provider>
  );
}
