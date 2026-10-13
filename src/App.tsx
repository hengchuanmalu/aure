import { Empty } from '@/ui/Empty';
import { ViewerDataProvider } from '@/state/DataProvider';
import { Shell } from "@/ui/Shell";
import { UiMotionProvider } from "@/ui/useUiMotion";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { HashRouter,Link,Navigate,Route,Routes,useLocation,useNavigate,useParams } from "react-router-dom";

const Home = lazy(() => import('@/pages/Home'));
const Library = lazy(() => import('@/pages/Library'));
const AlbumDetail = lazy(() => import('@/pages/AlbumDetail'));
const Collections = lazy(() => import('@/pages/Collections'));
const ModelDetail = lazy(() => import('@/pages/ModelDetail'));
const Models = lazy(() => import('@/pages/Models'));
const Settings = lazy(() => import('@/pages/Settings'));
const TagManager = lazy(() => import('@/pages/TagManager'));
const Viewer = lazy(() => import('@/features/viewer/Viewer').then(module => ({ default: module.Viewer })));

// Keep the shell and an underlying album mounted while a new route downloads.
function route(children: ReactNode) {
  return <Suspense fallback={<div className="page-pad" role="status">正在加载…</div>}>{children}</Suspense>;
}
function ViewerLoading() {
  const nav = useNavigate();
  const loc = useLocation();
  const { albumId } = useParams();
  const root = useRef<HTMLDivElement>(null);
  const close = () => {
    if (loc.state?.backgroundLocation) nav(-1);
    else nav(loc.state?.from || (albumId === 'favorites' ? '/favorites?tab=media' : albumId?.startsWith('profile-') ? `/models/${albumId.slice(8)}` : `/album/${albumId}`));
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    root.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  return <div ref={root} className="viewer" role="dialog" aria-label="正在加载图片浏览" tabIndex={-1}>
    <span role="status">正在加载…</span><button onClick={close}>返回详情</button>
  </div>;
}
function viewerRoute(children: ReactNode) {
  return <Suspense fallback={<ViewerLoading />}>{children}</Suspense>;
}

export default function App() {
  return (
    <UiMotionProvider>
      <HashRouter>
        <RouteWatcher />
        <AppRoutes />
      </HashRouter>
    </UiMotionProvider>
  );
}
function AppRoutes() {
  const location = useLocation();
  const background = location.state?.backgroundLocation;
  return <>
        <div inert={!!background} aria-hidden={background ? true : undefined}>
        <Routes location={background || location}>
          <Route path="/viewer/:albumId/:mediaId" element={viewerRoute(<Viewer />)} />
          <Route element={<Shell />}>
            <Route index element={route(<Home />)} />
            <Route path="library" element={route(<Library />)} />
            <Route path="album/:id" element={route(<AlbumDetail />)} />
            <Route path="models" element={route(<Models />)} />
            <Route path="models/:id" element={route(<ModelDetail />)} />
            <Route path="tags" element={route(<Library tagsView />)} />
            <Route path="tags/manage" element={route(<TagManager />)} />
            <Route path="settings/tags" element={<LegacyTagRoute />} />
            <Route path="favorites" element={route(<Collections />)} />
            <Route path="recent" element={route(<Collections recent />)} />
            <Route path="settings" element={route(<Settings />)} />
            <Route
              path="*"
              element={
                <Empty title="页面不存在">
                  <Link to="/">返回发现</Link>
                </Empty>
              }
            />
          </Route>
        </Routes>
        </div>
        {background && <Routes><Route path="/viewer/:albumId/:mediaId" element={viewerRoute(<ViewerDataProvider><Viewer /></ViewerDataProvider>)} /></Routes>}
  </>;
}
function LegacyTagRoute() {
  const location = useLocation();
  return <Navigate to={`/tags/manage${location.search}`} replace />;
}
function RouteWatcher() {
  const location = useLocation();
  useEffect(() => { window.dispatchEvent(new Event('jingji:route')); }, [location.key]);
  return null;
}
