type Listener = {
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
};
import type { ThumbnailEdge } from "@/domain/types";
type Job = {
  key: string;
  source: string;
  edge: ThumbnailEdge;
  listeners: Set<Listener>;
  running: boolean;
  priority: number;
};
type Request = { promise: Promise<string>; cancel: () => void };

/** An active view owns each request. Pending work vanishes with its last subscriber. */
export class ThumbnailQueue {
  private jobs = new Map<string, Job>();
  private active = 0;
  constructor(
    private generate: (source: string, edge: ThumbnailEdge) => Promise<string>,
    private concurrency = 2,
    private pendingLimit = 256,
  ) {}
  request(source: string, priority = 0, edge: ThumbnailEdge = 512): Request {
    const key = `${edge}:${source}`;
    let job = this.jobs.get(key);
    let listener: Listener;
    const promise = new Promise<string>((resolve, reject) => {
      listener = { resolve, reject };
    });
    if (!job) {
      if (this.jobs.size >= this.pendingLimit) {
        listener!.reject(Error("缩略图队列繁忙，请重试"));
        return { promise, cancel() {} };
      }
      job = {
        key,
        source,
        edge,
        listeners: new Set(),
        running: false,
        priority,
      };
      this.jobs.set(key, job);
    }
    job.listeners.add(listener!);
    job.priority = Math.max(job.priority, priority);
    this.pump();
    return {
      promise,
      cancel: () => {
        job!.listeners.delete(listener!);
        listener!.reject(new DOMException("请求已取消", "AbortError"));
        if (!job!.running && !job!.listeners.size) this.jobs.delete(key);
      },
    };
  }
  private pump() {
    for (const job of [...this.jobs.values()].sort(
      (a, b) => b.priority - a.priority,
    )) {
      if (this.active >= this.concurrency) break;
      if (job.running || !job.listeners.size) continue;
      this.active++;
      job.running = true;
      const finish = (value: string | undefined, error?: unknown) => {
        this.jobs.delete(job.key);
        this.active--;
        for (const listener of job.listeners)
          value === undefined
            ? listener.reject(error)
            : listener.resolve(value);
        this.pump();
      };
      Promise.resolve()
        .then(() => this.generate(job.source, job.edge))
        .then(
          (value) => finish(value),
          (error) => finish(undefined, error),
        );
    }
  }
}

const queue = new ThumbnailQueue(async (source, edge) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("image_thumbnail", { source, edge });
});
// Disk cache is authoritative. Rust revalidates size/mtime on every request;
// no unbounded URL or error cache is retained in the WebView.
export const requestThumbnail = (
  source: string,
  priority = 0,
  edge: ThumbnailEdge = 512,
) => queue.request(source, priority, edge);
