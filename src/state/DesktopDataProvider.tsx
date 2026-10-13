import { type DesktopView } from "@/domain/catalog-view";
import { type RecentView } from "@/domain/types";
import { seed } from "@/domain/database";
import { readSearchSuggestions } from '@/infrastructure/search-service';
import {
  execute,
  writeRecent,
  readView,
  initializeCatalog,
  restoreRecent,
  patchCatalog,
  resetCatalog,
  exportCatalogBackup,
  watchMigration,
} from "@/infrastructure/desktop-repository";
import { Context } from "@/state/data-context";
import { routeQuery } from "@/state/route-query";
import {
  confirmRestore,
  confirmFolderRefresh,
  confirmMediaRelink,
  syncFolders,
} from "@/infrastructure/catalog-maintenance";
import { useEffect, useRef, useState, type ReactNode } from "react";
function mergeViews(before: DesktopView, after: DesktopView): DesktopView {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...new Map([...a, ...b].map((item) => [item.id, item])).values(),
  ];
  return {
    ...after,
    visibleMediaIds: [
      ...new Set([
        ...(before.visibleMediaIds || []),
        ...(after.visibleMediaIds || []),
      ]),
    ],
    db: {
      ...after.db,
      albums: merge(before.db.albums, after.db.albums),
      media: merge(before.db.media, after.db.media),
      models: merge(before.db.models, after.db.models),
    },
  };
}

export function DesktopDataProvider({
  children,
  viewer = false,
}: {
  children: ReactNode;
  viewer?: boolean;
}) {
  const [view, setView] = useState<DesktopView>();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState("正在打开aure…");
  const current = useRef<DesktopView | undefined>(undefined);
  const generation = useRef(0);
  const loadedRoute = useRef(JSON.stringify(routeQuery(viewer)));
  const loadingMore = useRef<number | undefined>(undefined);
  const cache = useRef(new Map<string, DesktopView>());
  const invalidateRecentViews = () => {
    for (const [key, snapshot] of cache.current) {
      if (['recent', 'home'].includes(snapshot.query?.route || '')) cache.current.delete(key);
    }
  };
  const publish = (result: DesktopView) => {
    const snapshot = { ...result, query: JSON.parse(loadedRoute.current) };
    current.current = snapshot;
    cache.current.delete(loadedRoute.current);
    cache.current.set(loadedRoute.current, snapshot);
    while (cache.current.size > 4)
      cache.current.delete(cache.current.keys().next().value!);
    setView(snapshot);
    setRefreshing(false);
    setError("");
  };
  const jobs = useRef(Promise.resolve());
  const refresh = async () => {
    const token = ++generation.current;
    const query = routeQuery(viewer);
    const previousPages =
      current.current && loadedRoute.current === JSON.stringify(query)
        ? current.current.page
        : 0;
    let result = await readView(query);
    if (query.route === "viewer")
      result = { ...result, viewerMediaId: query.id };
    if (["library", "album", "model", "favorites"].includes(query.route)) {
      for (let page = 1; page <= previousPages; page++) {
        if (token !== generation.current) return;
        result = mergeViews(result, await readView({ ...query, page }));
      }
    }
    if (token === generation.current) publish(result);
  };
  useEffect(() => {
    let disposed = false;
    let ready = false;
    const open = async () => {
      try {
        const needsMigration = await initializeCatalog(null);
        if (needsMigration) {
          setOpening("首次迁移旧图库，请稍候；原始数据仍保留。");
          const stop = await watchMigration((progress) => {
            const names: Record<string, string> = {
              media: "媒体资料",
              albums: "写真集",
              models: "模特",
              summaries: "查询摘要",
              tags: "标签",
              groups: "分组",
            };
            if (!disposed)
              setOpening(
                `首次迁移${names[progress.phase] || "图库"} · ${progress.done} / ${progress.total}`,
              );
          });
          const raw = localStorage.getItem("jingji.mock.v1");
          // This full read is a one-time legacy migration, not the startup path.
          try {
            await initializeCatalog(raw || JSON.stringify(seed()));
          } finally {
            stop();
          }
          const historyRaw = localStorage.getItem("jingji.mock.v1.recent");
          if (historyRaw) {
            try {
              await restoreRecent(JSON.parse(historyRaw).items);
            } catch {
              setMessage("旧浏览记录未迁移，图库资料已保留");
            }
          }
        }
        if (!disposed) {
          await refresh();
          ready = true;
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    };
    const navigate = () => {
      const query = routeQuery(viewer);
      const key = JSON.stringify(query);
      if (loadedRoute.current === key) return;
      loadedRoute.current = key;
      generation.current++;
      setError("");
      const retained = cache.current.get(key);
      if (retained) {
        publish(retained);
        return;
      }
      current.current = undefined;
      // Keep the visible snapshot mounted until its replacement is ready. The
      // writable snapshot is cleared so neither continuation nor a queued write
      // can accidentally use the previous query's partial data.
      setRefreshing(true);
      const request = refresh();
      const token = generation.current;
      void request.catch((e) => {
        if (
          !disposed &&
          loadedRoute.current === key &&
          generation.current === token
        ) {
          setRefreshing(false);
          setError(String(e));
        }
      });
    };
    // Another desktop instance can commit to the same SQLite catalog while this
    // window is in the background. Refresh after queued writes without closing drafts.
    const resume = () => {
      if (
        !ready ||
        disposed ||
        document.visibilityState === "hidden" ||
        (!viewer && history.state?.usr?.backgroundLocation)
      )
        return;
      void jobs.current
        .then(() => {
          if (!disposed) {
            cache.current.clear();
            return refresh();
          }
        })
        .catch(() => {
          if (!disposed) setMessage("图库刷新失败，请重新打开页面重试");
        });
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("popstate", navigate);
    window.addEventListener("jingji:route", navigate);
    window.addEventListener("focus", resume);
    const changed = () => {
      if (!viewer && ready && !disposed) {
        cache.current.clear();
        void jobs.current
          .then(refresh)
          .catch(() => setMessage("图库刷新失败，请重试"));
      }
    };
    const recentChanged = (event: Event) => {
      if (viewer || !ready || disposed) return;
      invalidateRecentViews();
      const old = current.current;
      if (old) {
        const recent = (event as CustomEvent<RecentView[]>).detail;
        publish({ ...old, db: { ...old.db, recent } });
      }
    };
    window.addEventListener("jingji:catalog-changed", changed);
    window.addEventListener("jingji:recent-changed", recentChanged);
    document.addEventListener("visibilitychange", resume);
    void open();
    return () => {
      disposed = true;
      generation.current++;
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("jingji:route", navigate);
      window.removeEventListener("focus", resume);
      window.removeEventListener("jingji:catalog-changed", changed);
      window.removeEventListener("jingji:recent-changed", recentChanged);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  const refreshCommitted = async (failureMessage: string) => {
    const route = loadedRoute.current;
    setRefreshing(true);
    const request = refresh();
    const token = generation.current;
    try {
      await request;
    } catch {
      if (loadedRoute.current === route && generation.current === token) {
        // Persistence succeeded. Keep the displayed window read-only until a
        // new read succeeds, rather than inviting the editor to submit again.
        current.current = undefined;
        setRefreshing(false);
        setError(failureMessage);
      }
    }
  };
  const commit = (action: () => Promise<unknown>) => {
    const route = loadedRoute.current;
    const job = jobs.current.then(async () => {
      try {
        if (!current.current || route !== loadedRoute.current)
          throw Error("页面正在更新，请稍后重试");
        await action();
      } catch (e) {
        setMessage("保存失败，草稿仍保留");
        throw e;
      }
      cache.current.clear();
      await refreshCommitted('更改已保存，但刷新失败，请重试读取');
      if (viewer) window.dispatchEvent(new Event("jingji:catalog-changed"));
    });
    jobs.current = job.catch(() => {});
    return job;
  };
  useEffect(() => {
    if (viewer || !view?.db.settings.syncImportedFolders) return;
    let alive = true,
      busy = false;
    let lastIssues = 0;
    const sync = async () => {
      if (
        busy ||
        document.visibilityState === "hidden" ||
        document.querySelector('[role="dialog"],.viewer')
      )
        return;
      busy = true;
      try {
        const result = await syncFolders();
        if (alive && result.issues && result.issues !== lastIssues)
          setMessage("部分文件夹暂时不可用，请检查磁盘连接和文件夹路径");
        lastIssues = result.issues;
        if (alive && result.changed) {
          cache.current.clear();
          await jobs.current;
          await refresh();
        }
      } catch {
        if (alive) setMessage("文件夹同步失败，请检查磁盘连接后重试");
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void sync(), 30000);
    void sync();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [viewer, view?.db.settings.syncImportedFolders]);
  if (error && !view)
    return (
      <main className="recovery">
        <h1>暂时无法打开图库</h1>
        <p>{error}</p>
        <p>旧库和迁移备份仍保留，请检查磁盘空间后重试。</p>
        <button onClick={() => location.reload()}>重试</button>
      </main>
    );
  if (!view)
    return (
      <div className="loading" role="status">
        {opening}
      </div>
    );
  return (
    <Context.Provider
      value={{
        db: view.db,
        suggest: readSearchSuggestions,
        page: { ...view, refreshing },
        notice: setMessage,
        loadMore: async () => {
          if (loadingMore.current === generation.current || !current.current)
            return;
          const base = current.current;
          const query = routeQuery(viewer);
          if (
            !["library", "album", "model", "favorites"].includes(query.route) ||
            (base.page + 1) * base.limit >=
              (query.route === "favorites"
                ? Math.max(base.total, base.mediaTotal)
                : base.total)
          )
            return;
          const token = generation.current;
          loadingMore.current = token;
          try {
            const next = await readView({ ...query, page: base.page + 1 });
            if (token === generation.current && current.current) {
              const merged = mergeViews(current.current, next);
              publish(merged);
            }
          } finally {
            if (loadingMore.current === token) loadingMore.current = undefined;
          }
        },
        act: (op) => commit(() => execute(op)),
        mutate: (fn) => {
          return commit(async () => {
            // Earlier queued commits refresh this window before the next job runs.
            // Read then, so a later edit cannot restore fields from its old render.
            const snapshot = current.current!.db;
            const draft = structuredClone(snapshot);
            fn(draft);
            await patchCatalog(snapshot, draft);
          });
        },
        recordRecent: (entry) => {
          const job = jobs.current.then(async () => {
            let recent: RecentView[];
            try {
              recent = await writeRecent(entry);
            } catch {
              setMessage("浏览记录保存失败，图库未受影响");
              return;
            }
            // History changes affect both the recent list and discovery shelves.
            // Their cached windows contain ordered album records, not just IDs.
            invalidateRecentViews();
            const old = current.current;
            if (['recent', 'home'].includes(routeQuery(viewer).route)) {
              await refreshCommitted('浏览记录已保存，但刷新失败，请重试读取');
            } else if (old) {
              const next = { ...old, db: { ...old.db, recent } };
              publish(next);
            }
            if (viewer) window.dispatchEvent(new CustomEvent('jingji:recent-changed', { detail: recent }));
          });
          jobs.current = job.catch(() => {});
          return job;
        },
        reset: () => commit(() => resetCatalog(seed())),
        exportBackup: () => exportCatalogBackup(),
        restoreBackup: (token) =>
          commit(async () => {
            await confirmRestore(token);
            current.current = undefined;
          }),
        refreshFolder: (token) => commit(() => confirmFolderRefresh(token)),
        relinkMedia: (token) => commit(() => confirmMediaRelink(token)),
      }}
    >
      <div data-reduced-motion={view.db.settings.reducedMotion}>{children}</div>
      {error && (
        <div className="toast" role="alert">
          读取失败：{error}{" "}
          <button
            onClick={() => {
              setRefreshing(true);
              void refresh().catch((e) => {
                setRefreshing(false);
                setError(String(e));
              });
            }}
          >
            重试
          </button>
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
