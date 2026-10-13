import type { Database, RecentView } from "@/domain/types";
export interface Repository {
  read(): Promise<Database>;
  update(action: (draft: Database) => void): Promise<Database>;
  reset(): Promise<Database>;
  saveRecent(current: Database, recent: RecentView[]): Promise<Database>;
}
