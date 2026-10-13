import { catalog } from "@/domain/catalog";
import type { Album, Database } from "@/domain/types";
export const countMedia = (a: Album, d: Database) => {
  const summary = catalog(d).summaries.get(a.id);
  return `${summary?.images || 0} 张照片${summary?.videos ? ` · ${summary.videos} 个视频` : ""}`;
};
