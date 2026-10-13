import { expect, test, type Page } from "../support/browser.fixture";

async function setup(page: Page, fail = false) {
  await page.goto("/#/library?create=1");
  await page
    .getByRole("button", { name: "从文件夹导入", exact: true })
    .waitFor();
  await page.evaluate((fail) => {
    const image = "/tests/fixtures/media/p-1239291.jpg";
    (window as any).__TAURI_INTERNALS__ = {
      convertFileSrc: () => image,
      invoke: async (command: string) => {
        if (command === "image_thumbnail") return image;
        if (command === "catalog_import_context")
          return JSON.parse(localStorage.getItem("jingji.mock.v1")!);
        if (command === "select_album_folder")
          return {
            name: "写真",
            path: "D:/测试写真",
            issues: fail
              ? [
                  {
                    path: "D:/测试写真/损坏资料",
                    name: "损坏资料",
                    message: "album.json 格式错误",
                  },
                ]
              : [],
            albums: Array.from({ length: 3 }, (_, i) => ({
              path: `D:/测试写真/写真${i + 1}`,
              name: `新人物 NO.00${i + 1} 写真${i + 1}`,
              parentName: "新人物",
              skipped: 0,
              files: [
                {
                  path: `D:/测试写真/写真${i + 1}/cover.jpg`,
                  name: "cover.jpg",
                  kind: "image",
                  size: 100,
                },
              ],
            })),
          };
        throw Error(command);
      },
    };
  }, fail);
  await page.getByRole("button", { name: "从文件夹导入", exact: true }).click();
}

test("parent directory automatically imports each set once and reuses one person, without a batch review page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jingji.mock.v1")!),
  );
  expect(
    saved.albums.filter((a: any) =>
      a.sourceDirectory?.startsWith("D:/测试写真/"),
    ),
  ).toHaveLength(3);
  expect(saved.models.filter((m: any) => m.name === "新人物")).toHaveLength(1);
  await setup(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jingji.mock.v1")!),
  );
  expect(
    saved.albums.filter((a: any) =>
      a.sourceDirectory?.startsWith("D:/测试写真/"),
    ),
  ).toHaveLength(3);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "verification/automatic-import-browser.png" });
});

test("a bad child directory reports partial success without blocking valid sets", async ({
  page,
}) => {
  await setup(page, true);
  await expect(page.getByRole("alert")).toContainText("已导入 3 套");
  await expect(page.getByRole("alert")).toContainText("1 套未完成");
  await expect(page.getByRole("alert")).toContainText("album.json 格式错误");
  await expect(page.getByRole("dialog", { name: "批量导入写真" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jingji.mock.v1")!),
  );
  expect(
    saved.albums.filter((a: any) =>
      a.sourceDirectory?.startsWith("D:/测试写真/"),
    ),
  ).toHaveLength(3);
});
