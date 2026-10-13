import type { ImportRule } from "@/domain/importing";
export type CustomField = {
  id: string;
  label: string;
  value: string;
  group: string;
};
export type MediaItem = {
  sourcePath?: string;
  id: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
  videoPosterPercent?: 10 | 50 | 90;
  name: string;
  width: number;
  height: number;
  size: number;
  duration?: number;
  tags: string[];
  favorite: boolean;
  liked: boolean;
  rating: number;
  exif?: Record<string, string>;
  codec?: string;
  metadataRevision?: string;
  sourceRevision?: string;
};
export type Album = {
  importMetadata?: {
    ruleVersion: string;
    originalName: string;
    fields: Partial<
      Record<
        "name" | "number" | "modelIds" | "tags" | "coverMediaId" | "mediaIds",
        {
          source:
            "manifest" | "folder" | "catalog" | "parent" | "files" | "manual";
          evidence: string[];
          value: string | string[];
        }
      >
    >;
    unresolved: string[];
  };
  _summary?: {
    images: number;
    videos: number;
    bytes: number;
    tags: string[];
    searchText: string;
    previews: string[];
  };
  number?: string;
  sourceDirectory?: string;
  sourceFolderName?: string;
  coverMediaId?: string;
  coverCrop?: { x: number; y: number; zoom: number };
  declaredPhotoCount?: number;
  declaredSize?: string;
  id: string;
  name: string;
  subtitle: string;
  description: string;
  cover: string;
  mediaIds: string[];
  tags: string[];
  modelIds: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ModelProfile = {
  albumCount?: number;
  id: string;
  name: string;
  alias: string;
  bio: string;
  avatar: string;
  background: string;
  avatarFocus: number;
  avatarCrop?: { x: number; y: number; zoom: number };
  backgroundFocus: number;
  backgroundCrop?: { x: number; y: number; zoom: number };
  fields: CustomField[];
  links: { label: string; url: string }[];
  photoIds: string[];
};
export type Tag = { id: string; name: string; groupId: string };
export type TagGroup = { id: string; name: string };
export type RecentView = { albumId: string; mediaId?: string; at: string };
export type Database = {
  importRules?: ImportRule[];
  version: 1;
  albums: Album[];
  media: MediaItem[];
  models: ModelProfile[];
  tags: Tag[];
  groups: TagGroup[];
  recent: RecentView[];
  settings: {
    reducedMotion: boolean;
    syncImportedFolders?: boolean;
    sidebarOrder?: string[];
    videoPosterPercent?: 10 | 50 | 90;
    recommendationAutoRotate?: boolean;
    recommendationIntervalSeconds?: 3 | 6 | 10 | 15 | 30 | 60;
    recommendationTransitionMs?: 400 | 800 | 1200;
    recommendationPauseOnHover?: boolean;
  };
};

export type ThumbnailEdge = 512 | 1024 | 2048 | 3072;
