import { seed } from "@/domain/database";
import type { Database, RecentView } from "@/domain/types";
import type { Repository } from "@/infrastructure/repository";
export class MockRepository implements Repository {
  private hasSnapshot = false;
  constructor(
    private storage: Storage,
    private key = "jingji.mock.v1",
  ) {}
  async read() {
    const raw = this.storage.getItem(this.key);
    this.hasSnapshot = raw !== null;
    const d = raw ? (JSON.parse(raw) as Database) : seed();
    if (
      d.version !== 1 ||
      !Array.isArray(d.albums) ||
      !Array.isArray(d.media) ||
      !Array.isArray(d.models) ||
      !Array.isArray(d.tags) ||
      !Array.isArray(d.groups) ||
      !Array.isArray(d.recent) ||
      !d.settings
    )
      throw Error("预览库版本不兼容或数据损坏。请导出备份后重置预览库。");
    const recent = this.storage.getItem(`${this.key}.recent`);
    if (recent) {
      try {
        const record = JSON.parse(recent);
        if (record.version === 1 && Array.isArray(record.items)) {
          const albums = new Set(d.albums.map((a) => a.id));
          d.recent = record.items
            .filter(
              (r: RecentView) =>
                r && typeof r.at === "string" && albums.has(r.albumId),
            )
            .slice(0, 40);
        }
      } catch {
        /* A broken optional history must not prevent opening the library. */
      }
    }
    return d;
  }
  async update(action: (draft: Database) => void) {
    const d = structuredClone(await this.read());
    action(d);
    this.storage.setItem(this.key, JSON.stringify(d));
    this.hasSnapshot = true;
    return d;
  }
  async reset() {
    const d = seed();
    this.storage.setItem(this.key, JSON.stringify(d));
    this.hasSnapshot = true;
    this.storage.removeItem(`${this.key}.recent`);
    return d;
  }
  async saveRecent(current: Database, recent: RecentView[]) {
    // Persist the initial library only on the first actual action, preserving read/cancel semantics.
    if (!this.hasSnapshot) {
      this.storage.setItem(this.key, JSON.stringify(current));
      this.hasSnapshot = true;
    }
    const items = recent.slice(0, 40);
    this.storage.setItem(
      `${this.key}.recent`,
      JSON.stringify({ version: 1, items }),
    );
    return { ...current, recent: items };
  }
}
