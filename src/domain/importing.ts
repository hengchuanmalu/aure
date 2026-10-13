export type FolderFile = {
  path: string;
  name: string;
  kind: "image" | "video";
  size: number;
};
export type FolderScan = {
  path: string;
  name: string;
  files: FolderFile[];
  skipped: number;
  manifest?: AlbumManifest;
  parentName?: string;
  metadataSource?: "manifest" | "folder";
};
export type AlbumManifest = {
  version: 1;
  name: string;
  number: string;
  models: string[];
  tags: string[];
  cover: string;
  media: string[];
};
/** Existing catalogs retain these rules for compatible reads and exports. */
export type ImportRule = {
  id: string;
  modelId: string;
  template: string;
  updatedAt: string;
};
export const pathKey = (path: string) =>
  path.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
