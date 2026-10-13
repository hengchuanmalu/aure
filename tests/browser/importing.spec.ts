import { expect, test, type Page } from "../support/browser.fixture";

async function setup(page: Page, raw = false) {
  await page.goto("/#/library?create=1");
  await page
    .getByRole("button", { name: "从文件夹导入", exact: true })
    .waitFor();
  await page.evaluate((raw) => {
    const state = {
      calls: 0,
      cancel: false,
      error: "",
      directory: "D:/fixtures/json-set",
    };
    (window as any).__folderState = state;
    (window as any).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string) =>
        "/tests/fixtures/media/p-1239291.jpg?file=" + encodeURIComponent(path),
      invoke: async (command: string, args: any = {}) => {
        if (command === "image_thumbnail")
          return "/tests/fixtures/media/p-1239291.jpg";
        if (command === "catalog_import_context")
          return JSON.parse(localStorage.getItem("jingji.mock.v1")!);
        if (command === "catalog_entity")
          return JSON.parse(
            localStorage.getItem("jingji.mock.v1")!,
          ).albums.find((a: any) => a.id === args.id);
        if (command !== "select_album_folder")
          throw Error("Unexpected command: " + command);
        state.calls++;
        if (state.cancel) return null;
        if (state.error) throw Error(state.error);
        return {
          name: raw ? "新模特 NO.009 夏日 [2P1V-15MB]" : "任意文件夹名",
          path: state.directory,
          parentName: "新模特",
          skipped: 1,
          manifest: raw
            ? undefined
            : {
                version: 1,
                name: "JSON 写真",
                number: "009",
                models: ["林夏", "新模特"],
                tags: ["清新", "新标签"],
                cover: "002.jpg",
                media: ["002.jpg", "001.jpg", "003.mp4"],
              },
          files: ["002.jpg", "001.jpg", "003.mp4"].map((name) => ({
            name,
            path: state.directory + "/" + name,
            kind: name.endsWith(".mp4") ? "video" : "image",
            size: 100,
          })),
        };
      },
    };
  }, raw);
}
const snapshot = (page: Page) =>
  page.evaluate(() => localStorage.getItem("jingji.mock.v1"));

test("one selection automatically saves JSON data without review and existing editor remains available", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("JSON 写真");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "记住此模特的匹配规则" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__folderState.calls)).toBe(
    1,
  );
  let db = JSON.parse((await snapshot(page))!);
  const album = db.albums.find((a: any) => a.name === "JSON 写真");
  expect(album.number).toBe("009");
  expect(
    album.mediaIds.map(
      (id: string) => db.media.find((m: any) => m.id === id).name,
    ),
  ).toEqual(["002.jpg", "001.jpg", "003.mp4"]);
  expect(
    album.modelIds.map(
      (id: string) => db.models.find((m: any) => m.id === id).name,
    ),
  ).toEqual(["林夏", "新模特"]);
  await page.getByRole("button", { name: "编辑写真集", exact: true }).click();
  await page.getByLabel("写真集名称", { exact: true }).fill("我的修改");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("我的修改");
  db = JSON.parse((await snapshot(page))!);
  expect(
    db.albums.find((a: any) => a.id === album.id).importMetadata.fields.name
      .source,
  ).toBe("manual");
  await setup(page);
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("我的修改");
  db = JSON.parse((await snapshot(page))!);
  expect(
    db.albums.filter((a: any) => a.sourceDirectory === album.sourceDirectory),
  ).toHaveLength(1);
});

test("raw folder gets local metadata and actual file counts without JSON or another confirmation", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("夏日");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  const db = JSON.parse((await snapshot(page))!);
  const album = db.albums.find((a: any) => a.name === "夏日");
  expect(album.number).toBe("009");
  expect(
    album.modelIds.map(
      (id: string) => db.models.find((m: any) => m.id === id).name,
    ),
  ).toEqual(["新模特"]);
  expect(album.mediaIds).toHaveLength(3);
  expect(album.importMetadata.ruleVersion).toBe("local-text-v1");
  expect(album.sourceFolderName).toBe("新模特 NO.009 夏日 [2P1V-15MB]");
});

test("cancelling the system picker keeps the draft and catalog unchanged", async ({
  page,
}) => {
  await setup(page);
  const before = await snapshot(page);
  await page.getByLabel("写真集名称", { exact: true }).fill("原草稿");
  await page.evaluate(() => {
    (window as any).__folderState.cancel = true;
  });
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("写真集名称", { exact: true })).toHaveValue(
    "原草稿",
  );
  expect(await snapshot(page)).toBe(before);
});

test("unreadable files and browser fallback report errors without losing the draft", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("写真集名称", { exact: true }).fill("保留草稿");
  await page.evaluate(() => {
    (window as any).__folderState.error = "album.json 格式错误";
  });
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("格式错误");
  await expect(page.getByLabel("写真集名称", { exact: true })).toHaveValue(
    "保留草稿",
  );
  await page.evaluate(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("桌面版");
});

test("failed automatic save retains a retry and does not rescan or duplicate imported data", async ({
  page,
}) => {
  await setup(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "jingji.mock.v1") throw Error("测试保存失败");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("1 套未完成");
  expect(await snapshot(page)).toBe(before);
  await page.evaluate(() => {
    (window as any).__restoreStorage();
  });
  await page.getByRole("button", { name: "重试导入", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("JSON 写真");
  expect(await page.evaluate(() => (window as any).__folderState.calls)).toBe(
    1,
  );
});
