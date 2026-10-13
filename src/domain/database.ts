import type { Database } from "@/domain/types";
export const uid = () => crypto.randomUUID();
export const seed = (): Database => ({
  version: 1,
  albums: [],
  media: [],
  models: [],
  tags: [],
  groups: [],
  recent: [],
  importRules: [],
  settings: { reducedMotion: false },
});
