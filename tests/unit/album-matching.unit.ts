import { describe, expect, it } from "vitest";
import { matchAlbumMetadata } from "../../src/application/album-matching";
import {
  prepareAlbumImport,
  commitAlbumImport,
} from "../../src/application/album-import";
import { applyOperation } from "../../src/application/operations";
import { prepareBatchImport } from "../../src/application/batch-album-import";
import { importAutomatically } from "../../src/application/automatic-album-import";
import type { FolderScan } from "../../src/domain/importing";
import { seedFixture } from "../support/demo.fixture";

const raw = (name: string, parentName = "来自百度网盘"): FolderScan => ({
  path: `D:/test/${parentName}/${name}`,
  name,
  parentName,
  skipped: 0,
  files: ["2.jpg", "10.jpg", "cover.jpg", "1.mp4"].map((name) => ({
    name,
    path: `D:/test/${parentName}/${name}`,
    kind: name.endsWith("mp4") ? "video" : "image",
    size: 10,
  })),
});
const sources = (folder: FolderScan) =>
  Object.fromEntries(folder.files.map((f) => [f.path, `asset://${f.path}`]));
describe("deterministic import metadata", () => {
  it("extracts explicit person/number/title/counts with leading zeroes, without confusing a character", () => {
    const folder = raw(
      "Machi馬吉 NO.009 Robin HonkaiStar Rail [62P-882MB]",
      "Machi馬吉",
    );
    const result = matchAlbumMetadata(folder, seedFixture());
    expect(result.manifest).toMatchObject({
      name: "Robin HonkaiStar Rail",
      number: "009",
      models: ["Machi馬吉"],
    });
    expect(result.declaredPhotoCount).toBe(62);
    expect(result.declaredSize).toBe("882MB");
    expect(result.sources.modelIds?.source).toBe("parent");
    const mixed = matchAlbumMetadata(
      raw("布丁大法 – NO.112 肉包子[21P-2V-15.2M]", "布丁大法"),
      seedFixture(),
    );
    expect(mixed.manifest).toMatchObject({
      name: "肉包子",
      number: "112",
      models: ["布丁大法"],
    });
  });
  it("uses unique literal aliases and refuses person/date/number-only guesses", () => {
    const db = seedFixture();
    db.models[0].alias = "鱼子酱Fish";
    expect(
      matchAlbumMetadata(
        raw(
          "[XIUREN秀人网] 2024.09.20 NO.9189 鱼子酱Fish 私购流出",
          "鱼子酱fish",
        ),
        db,
      ).manifest.models,
    ).toEqual(["林夏"]);
    expect(
      matchAlbumMetadata(raw("鱼子酱Fish NO.009 清新"), db).manifest.models,
    ).toEqual(["林夏"]);
    expect(matchAlbumMetadata(raw("NO.10418"), db).manifest).toMatchObject({
      name: "NO.10418",
      models: [],
      number: "10418",
    });
    expect(
      matchAlbumMetadata(raw("2024.09.20 夏日 [21P-15MB]"), db).manifest.number,
    ).toBe("");
    expect(
      matchAlbumMetadata(raw("林夏夏 NO.001 日常"), db).manifest.models,
    ).toEqual([]);
    db.models[1].alias = "鱼子酱Fish";
    const ambiguous = matchAlbumMetadata(raw("鱼子酱Fish NO.009 日常"), db);
    expect(ambiguous.manifest.models).toEqual([]);
    expect(ambiguous.unresolved).not.toEqual([]);
    expect(
      matchAlbumMetadata(raw("江月 NO.009 日常", "林夏"), db).manifest.models,
    ).toEqual([]);
  });
  it("preserves valid manifests, handles ambiguous identities without blocking, and keeps edits on repeated imports", () => {
    const db = seedFixture();
    db.models.push({ ...db.models[0], id: "same-name" });
    const folder = raw("江月 NO.999 自动标题", "江月");
    folder.manifest = {
      version: 1,
      name: "人工资料",
      number: "003",
      models: ["林夏", "江月"],
      tags: [],
      cover: "cover.jpg",
      media: [],
    };
    const pending = prepareAlbumImport(folder, db, sources(folder), "new");
    expect(pending.album.name).toBe("人工资料");
    expect(pending.album.modelIds).toEqual(["m5"]);
    expect(pending.album.importMetadata?.unresolved).toHaveLength(1);
    commitAlbumImport(db, pending, pending.album);
    applyOperation(db, {
      type: "saveAlbum",
      album: { ...db.albums[0], name: "我的修改" },
    });
    expect(db.albums[0].importMetadata?.fields.name?.source).toBe("manual");
    const before = structuredClone(db);
    const duplicate = prepareBatchImport(
      { path: folder.path, name: folder.name, albums: [folder], issues: [] },
      db,
      sources(folder),
    );
    expect(duplicate.entries[0].status).toBe("duplicate");
    expect(db).toEqual(before);
  });
  it("auto imports uncertain albums, preserves source paths, and retries only failures", async () => {
    const db = seedFixture();
    const folders = [raw("NO.10418"), raw("NO.10419")];
    const batch = prepareBatchImport(
      { path: "D:/test", name: "test", albums: folders, issues: [] },
      db,
      Object.assign({}, ...folders.map(sources)),
    );
    let fail = true;
    const save = async (
      pending: Parameters<typeof commitAlbumImport>[1],
      album: Parameters<typeof commitAlbumImport>[2],
    ) => {
      if (album.number === "10419" && fail) throw Error("磁盘繁忙");
      commitAlbumImport(db, pending, album);
    };
    expect(await importAutomatically(batch, save)).toMatchObject({
      imported: 1,
      retryable: true,
      failures: ["NO.10419：磁盘繁忙"],
    });
    fail = false;
    expect(await importAutomatically(batch, save)).toMatchObject({
      imported: 2,
      retryable: false,
      failures: [],
    });
    expect(
      db.albums.filter((a) => a.sourceDirectory?.startsWith("D:/test/")),
    ).toHaveLength(2);
    expect(db.albums[0].modelIds).toEqual([]);
    expect(
      db.albums[0].mediaIds.map(
        (id) => db.media.find((m) => m.id === id)?.kind,
      ),
    ).toEqual(["image", "image", "image", "video"]);
    expect(batch.entries[0].pending?.media.map((m) => m.sourcePath)).toEqual(
      folders[0].files.map((f) => f.path),
    );
  });
});
