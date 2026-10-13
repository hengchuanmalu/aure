import type { FolderScan, AlbumManifest } from "@/domain/importing";
import type { Album, Database, ModelProfile } from "@/domain/types";

export const IMPORT_RULE_VERSION = "local-text-v1";
const key = (text: string) => text.normalize("NFKC").trim().toLowerCase();
const word = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);
const container = (name: string) =>
  /^(?:写真|写真集|图库|模特|图片|视频|下载|photos?|albums?|models?)$/i.test(
    name,
  ) || /来自|网盘|合集|总目录|备份|下载/.test(name);
const strip = (text: string) =>
  text.replace(/^[\s–—\-_.,，、&＆]+|[\s–—\-_.,，、&＆]+$/g, "").trim();

/** Match names as literal text, never as regular expressions or fuzzy identities. */
function occurrences(text: string, token: string) {
  const haystack = key(text),
    needle = key(token);
  if (!needle) return [];
  const hits: number[] = [];
  for (let offset = 0; offset <= haystack.length - needle.length;) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    if (!word(haystack[start - 1]) && !word(haystack[start + needle.length]))
      hits.push(start);
    offset = start + needle.length;
  }
  return hits;
}
export function resolveModelName(models: ModelProfile[], name: string) {
  return models.filter(
    (model) =>
      key(model.name) === key(name) ||
      (!!model.alias.trim() && key(model.alias) === key(name)),
  );
}

export type MatchedAlbumMetadata = {
  manifest: AlbumManifest;
  sources: Partial<
    Record<
      keyof NonNullable<Album["importMetadata"]>["fields"],
      {
        source: NonNullable<
          NonNullable<Album["importMetadata"]>["fields"]["name"]
        >["source"];
        evidence: string[];
      }
    >
  >;
  unresolved: string[];
  declaredPhotoCount?: number;
  declaredSize?: string;
};

export function matchAlbumMetadata(
  folder: FolderScan,
  db: Database,
): MatchedAlbumMetadata {
  if (folder.manifest && folder.metadataSource !== "folder") {
    const manifest = folder.manifest;
    if (manifest.version !== 1 || !manifest.name.trim())
      throw Error("album.json 资料无效");
    return {
      manifest,
      unresolved: [],
      sources: {
        name: { source: "manifest", evidence: [manifest.name] },
        number: { source: "manifest", evidence: [manifest.number] },
        modelIds: { source: "manifest", evidence: manifest.models },
        tags: { source: "manifest", evidence: manifest.tags },
        coverMediaId: { source: "manifest", evidence: [manifest.cover] },
        mediaIds: {
          source: manifest.media.length ? "manifest" : "files",
          evidence: manifest.media,
        },
      },
    };
  }
  const original = folder.name;
  const normalized = original.normalize("NFKC");
  const markers = [
    ...normalized.matchAll(
      /(?:^|[^\p{L}\p{N}])((?:NO\s*[.．:_-]?|VOL\s*[.．:_-]?|第\s*)(\d+)(?:\s*[期套])?)(?=$|[^\d])/giu,
    ),
  ];
  const unresolved: string[] = [];
  const marker = markers.length === 1 ? markers[0] : undefined;
  if (markers.length > 1) unresolved.push("编号标记不唯一");
  const number = marker?.[2] || "";
  // Person evidence belongs to the heading; titles/characters after NO are not people.
  const heading = marker
    ? normalized.slice(0, marker.index! + marker[0].indexOf(marker[1]))
    : normalized;
  const byId = new Map<string, ModelProfile>();
  const tokens: string[] = [];
  let ambiguous = false;
  for (const token of new Set(
    db.models.flatMap((m) => [m.name, m.alias]).filter((t) => t.trim()),
  )) {
    if (!occurrences(heading, token).length) continue;
    const candidates = resolveModelName(db.models, token);
    if (candidates.length !== 1) {
      ambiguous = true;
      continue;
    }
    // Without a numbered heading, only a leading identity is strong evidence.
    if (!marker && !key(heading).startsWith(key(token))) continue;
    byId.set(candidates[0].id, candidates[0]);
    tokens.push(token);
  }
  const parent = (folder.parentName || "").trim();
  const parentModels =
    parent && !container(parent) ? resolveModelName(db.models, parent) : [];
  if (parentModels.length > 1) ambiguous = true;
  const conflictingParent =
    parentModels.length === 1 && byId.size > 0 && !byId.has(parentModels[0].id);
  let modelNames: string[] = [];
  let modelSource: "catalog" | "parent" = "catalog";
  if (ambiguous || conflictingParent) {
    unresolved.push("模特证据冲突或名称不唯一");
  } else if (byId.size) {
    modelNames = [...byId.values()].map((m) => m.name);
  } else if (parentModels.length === 1) {
    // A conflicting explicit heading is retained rather than silently reassigned.
    const prefix = strip(
      heading
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\b\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}\b/g, ""),
    );
    if (
      marker &&
      prefix &&
      key(prefix) !== key(parent) &&
      !occurrences(prefix, parent).length
    ) {
      unresolved.push("目录人物与父目录不一致");
    } else {
      modelNames = [parentModels[0].name];
      modelSource = "parent";
    }
  } else if (
    marker &&
    parent &&
    !container(parent) &&
    !/[\d\[\]{}]/.test(parent) &&
    key(strip(heading)) === key(parent)
  ) {
    // A new person requires the same explicit identity in both directory levels.
    modelNames = [parent];
    modelSource = "parent";
  }
  let title = normalized;
  if (marker) title = title.replace(marker[1], "");
  const countBlocks = [...title.matchAll(/\[([^\]]+)\]/g)].filter(
    (m) => /\d+\s*[PV]/i.test(m[1]) && /^[\d\s.PVKMGBT+\-,/]+$/i.test(m[1]),
  );
  for (const block of countBlocks) title = title.replace(block[0], "");
  const photo =
    countBlocks.length === 1
      ? /(?:^|[^\d])(\d+)\s*P/i.exec(countBlocks[0][1])
      : null;
  const size =
    countBlocks.length === 1
      ? /\d+(?:\.\d+)?\s*(?:GB|MB|KB|G|M|K)(?=$|[^A-Z])/i.exec(
          countBlocks[0][1],
        )
      : null;
  if (modelNames.length) {
    const removable = [...tokens, parent]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    // Remove only a leading, confirmed person token; leave characters in the title.
    title = strip(title);
    for (const token of removable) {
      if (
        key(title).startsWith(key(token)) &&
        !word(key(title)[key(token).length])
      )
        title = strip(title.slice(token.normalize("NFKC").length));
    }
  }
  const name = strip(title) || original;
  const tags = db.tags
    .filter(
      (tag) =>
        key(tag.name).length >= 2 &&
        occurrences(name, tag.name).length &&
        db.tags.filter((t) => key(t.name) === key(tag.name)).length === 1,
    )
    .map((t) => t.name);
  const cover =
    folder.files.find(
      (f) => f.kind === "image" && /^cover\.[^.]+$/i.test(f.name),
    ) || folder.files.find((f) => f.kind === "image");
  return {
    manifest: {
      version: 1,
      name,
      number,
      models: modelNames,
      tags,
      cover: cover?.name || "",
      media: [],
    },
    sources: {
      name: { source: "folder", evidence: [original] },
      number: { source: "folder", evidence: marker ? [marker[1]] : [] },
      modelIds: {
        source: modelSource,
        evidence: modelNames.length
          ? modelSource === "parent"
            ? [parent, heading]
            : tokens
          : [],
      },
      tags: { source: "catalog", evidence: tags },
      coverMediaId: { source: "files", evidence: cover ? [cover.name] : [] },
      mediaIds: { source: "files", evidence: [] },
    },
    unresolved,
    declaredPhotoCount: photo ? Number(photo[1]) : undefined,
    declaredSize: size?.[0],
  };
}
