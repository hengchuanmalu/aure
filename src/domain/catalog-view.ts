import type { Database } from "@/domain/types";
export type CatalogPage = {
  /** A previous read-only snapshot remains visible while a new query is pending. */
  refreshing?: boolean;
  /** Conditions of the visible snapshot, retained until the next query succeeds. */
  query?: { route: string; model: string };
  coverRevisions?: Record<string, string>;
  page: number;
  limit: number;
  total: number;
  mediaTotal: number;
  albumTotal: number;
  modelTotal: number;
  mediaCount: number;
  viewer?: { index: number; total: number; previous?: string; next?: string };
  /** Media ID belonging to this snapshot while the next viewer read is pending. */
  viewerMediaId?: string;
  visibleMediaIds?: string[];
  /** First item in the complete album order, independent of the current window/filter. */
  firstMediaId?: string;
  tagAlbumCounts?: Record<string, number>;
  tagMediaCounts?: Record<string, number>;
};
export type DesktopView = CatalogPage & { db: Database };
