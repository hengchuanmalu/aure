import type { Operation } from "@/application/operations";
import type { CatalogPage } from "@/domain/catalog-view";
import type { Database, RecentView } from "@/domain/types";
import type { SearchSuggestion } from '@/domain/search';
import { createContext, useContext } from "react";
export type Store = {
  db: Database;
  suggest: (query: string) => Promise<SearchSuggestion[]>;
  page?: CatalogPage;
  loadMore?: () => Promise<void>;
  act: (op: Operation) => Promise<void>;
  mutate: (fn: (d: Database) => void) => Promise<void>;
  reset: () => Promise<void>;
  notice: (s: string) => void;
  recordRecent: (entry?: RecentView) => Promise<void>;
  exportBackup?: () => Promise<boolean>;
  restoreBackup?: (token: string) => Promise<void>;
  refreshFolder?: (token: string) => Promise<void>;
  relinkMedia?: (token: string) => Promise<void>;
};
export const Context = createContext<Store>(null!);

export const useData = () => useContext(Context);
