import { applyOperation } from "@/application/operations";
import type { Database, RecentView } from "@/domain/types";
import { MockRepository } from "@/infrastructure/mock-repository";
import { suggestFromDatabase } from '@/infrastructure/search-service';
import { Context } from "@/state/data-context";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function MockDataProvider({ children }: { children: ReactNode }) {
  const [repo] = useState(() => new MockRepository(localStorage));
  const jobs = useRef(Promise.resolve());
  const [db, setDb] = useState<Database>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const current = useRef<Database | undefined>(undefined);
  const publish = (value: Database) => {
    current.current = value;
    setDb(value);
  };
  useEffect(() => {
    repo
      .read()
      .then(publish)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 3500);
      return () => clearTimeout(t);
    }
  }, [message]);
  const mutate = (fn: (d: Database) => void) => {
    const job = jobs.current.then(async () => {
      try {
        publish(await repo.update(fn));
      } catch (e) {
        setMessage("保存失败，草稿仍保留");
        throw e;
      }
    });
    jobs.current = job.catch(() => {});
    return job;
  };
  const recordRecent = (entry?: RecentView) => {
    const job = jobs.current.then(async () => {
      const snapshot = current.current;
      if (!snapshot) return;
      try {
        const recent = entry
          ? [
              entry,
              ...snapshot.recent.filter((r) => r.albumId !== entry.albumId),
            ]
          : [];
        publish(await repo.saveRecent(snapshot, recent));
      } catch {
        setMessage("浏览记录保存失败，图库未受影响");
      }
    });
    jobs.current = job.catch(() => {});
    return job;
  };
  if (error)
    return (
      <main className="recovery">
        <h1>暂时无法读取预览库</h1>
        <p>{error}</p>
        <button
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([localStorage.getItem("jingji.mock.v1") || ""], {
                type: "application/json",
              }),
            );
            a.download = "aure-recovery.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          导出原始数据
        </button>
        <button
          onClick={async () => {
            await repo.reset();
            location.reload();
          }}
        >
          重置预览库
        </button>
      </main>
    );
  if (!db) return <div className="loading">正在打开aure…</div>;
  return (
    <Context.Provider
      value={{
        db,
        suggest: async (query) => suggestFromDatabase(current.current!, query),
        mutate,
        recordRecent,
        act: (op) => mutate((d) => applyOperation(d, op)),
        reset: async () => {
          const job = jobs.current.then(async () =>
            publish(await repo.reset()),
          );
          jobs.current = job.catch(() => {});
          return job;
        },
        notice: setMessage,
      }}
    >
      <div data-reduced-motion={db.settings.reducedMotion}>{children}</div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
