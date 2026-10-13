import { expect, test, type Page } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

async function delayedEditingDesktop(page: Page) {
  await page.addInitScript((fixture) => {
    const w = window as any;
    w.__editingFixture = fixture;
    w.__editingWrites = [];
    w.__editingRelease = undefined;
    w.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any = {}) => {
        if (command === "catalog_initialize") return false;
        if (command === "catalog_recent") return [];
        if (command === "catalog_entity")
          return structuredClone(fixture.models.find((item) => item.id === args.id));
        if (command === "catalog_model_albums")
          return fixture.albums.filter((item) => item.modelIds.includes(args.id)).map((item) => item.id);
        if (command === "image_thumbnail") return fixture.media[0].src;
        if (command === "original_cover_revision") return "editing-fixture";
        if (command === "catalog_candidates") {
          const items = args.kind === "albums" ? fixture.albums : args.kind === "models" ? fixture.models : fixture.media;
          return { items: structuredClone(items), total: items.length };
        }
        if (command === "catalog_operation" || command === "catalog_patch") {
          w.__editingWrites.push(structuredClone(args));
          await new Promise<void>((resolve, reject) => {
            w.__editingRelease = (fail = false) => fail ? reject(Error("测试写入失败")) : resolve();
          });
          if (command === "catalog_operation" && args.op.type === "saveModel") {
            const index = fixture.models.findIndex((item) => item.id === args.op.model.id);
            if (index < 0) fixture.models.push(args.op.model);
            else fixture.models[index] = args.op.model;
          }
          if (command === "catalog_operation" && args.op.type === "saveAlbum") {
            const index = fixture.albums.findIndex((item) => item.id === args.op.album.id);
            if (index < 0) fixture.albums.push(args.op.album);
            else fixture.albums[index] = args.op.album;
          }
          if (command === "catalog_patch") {
            for (const group of args.changes.groups || []) {
              const existing = fixture.groups.find((item) => item.id === group.id);
              if (existing) Object.assign(existing, group);
              else fixture.groups.push(group);
            }
          }
          return;
        }
        if (command === "catalog_view")
          return {
            db: structuredClone(fixture), page: 0, limit: 96,
            total: fixture.albums.length, mediaTotal: fixture.media.length,
            albumTotal: fixture.albums.length, modelTotal: fixture.models.length,
            mediaCount: fixture.media.length, visibleMediaIds: fixture.media.map((item) => item.id),
          };
        throw Error(`Unexpected editing fixture native call: ${command}`);
      },
    };
  }, seedFixture());
}

test("confirming a Chinese category composition does not choose or clear the unfinished category", async ({ page }) => {
  await page.goto("/#/tags");
  await page.locator(".topbar").getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByRole("button", { name: "标签分类", exact: true }).click();
  const input = page.getByRole("textbox", { name: "搜索或创建分类", exact: true });
  await input.fill("拍摄主题");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("拍摄主题");
  await expect(page.getByRole("button", { name: "标签分类", exact: true })).toHaveText("选择或创建分类");
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "标签分类", exact: true })).toHaveText("拍摄主题");
});

test("pending model save prevents edits that would be silently lost when the save finishes", async ({ page }) => {
  await delayedEditingDesktop(page);
  await page.goto("/#/models");
  await page.locator(".topbar").getByRole("button", { name: "添加模特", exact: true }).click();
  const name = page.getByLabel("模特名称", { exact: true });
  await name.fill("准备保存的模特");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(1);
  await expect(name).toBeDisabled();
  await expect(page.getByRole("button", { name: "详细资料", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "添加模特", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__editingRelease());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__editingFixture.models.filter((item: any) => item.name === "准备保存的模特").length)).toBe(1);
});

test("pending group save cannot be cancelled or changed and produces one group", async ({ page }) => {
  await delayedEditingDesktop(page);
  await page.goto("/#/settings/tags");
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  const input = page.getByLabel("名称", { exact: true });
  await input.fill("旅行主题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(1);
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /正在保存|保存/, exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "新建分组", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__editingRelease());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__editingFixture.groups.filter((item: any) => item.name === "旅行主题").length)).toBe(1);
});

test("failed model save preserves every edited section and unlocks the draft for a successful retry", async ({ page }) => {
  await delayedEditingDesktop(page);
  await page.goto("/#/models");
  await page.locator(".topbar").getByRole("button", { name: "添加模特", exact: true }).click();
  await page.getByLabel("模特名称", { exact: true }).fill("跨分区保留的草稿");
  await page.getByRole("button", { name: "详细资料", exact: true }).click();
  await page.getByLabel("身高", { exact: true }).fill("168");
  await page.getByRole("button", { name: "社交链接", exact: true }).click();
  await page.getByRole("button", { name: "添加社交链接", exact: true }).click();
  await page.getByLabel("网址", { exact: true }).fill("x.com/aure_test");
  await page.getByRole("button", { name: "关联写真集", exact: true }).click();
  await page.getByRole("checkbox", { name: "光落在肩上", exact: true }).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(1);
  await expect(page.getByRole("checkbox", { name: "光落在肩上", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__editingRelease(true));
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("保存失败，草稿已保留，请重试");
  await expect(page.getByRole("checkbox", { name: "光落在肩上", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "光落在肩上", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "详细资料", exact: true }).click();
  await expect(page.getByLabel("身高", { exact: true })).toHaveValue("168");
  await page.getByRole("button", { name: "社交链接", exact: true }).click();
  await expect(page.getByLabel("网址", { exact: true })).toHaveValue("https://x.com/aure_test");
  await page.getByRole("button", { name: "基本资料", exact: true }).click();
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue("跨分区保留的草稿");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(2);
  await page.evaluate(() => (window as any).__editingRelease());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__editingWrites[1].op);
  expect(saved.model.fields).toContainEqual(expect.objectContaining({ label: "身高", value: "168 cm" }));
  expect(saved.model.links).toEqual([{ label: "Twitter", url: "https://x.com/aure_test" }]);
  expect(saved.albumIds).toEqual(["a0"]);
});

test("failed group save retains the name and retry cannot submit two copies", async ({ page }) => {
  await delayedEditingDesktop(page);
  await page.goto("/#/settings/tags");
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  const input = page.getByLabel("名称", { exact: true });
  await input.fill("失败后保留的分组");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(1);
  await page.evaluate(() => (window as any).__editingRelease(true));
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("保存失败，请重试");
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("失败后保留的分组");
  await page.getByRole("button", { name: "保存", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click(); button.click();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(2);
  await page.evaluate(() => (window as any).__editingRelease());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__editingFixture.groups.filter((item: any) => item.name === "失败后保留的分组").length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__editingWrites.length)).toBe(2);
});

test("album editor keeps its existing pending-save protection and preserves a failed draft", async ({ page }) => {
  await delayedEditingDesktop(page);
  await page.goto("/#/library?create=1");
  const name = page.getByLabel("写真集名称", { exact: true });
  await name.fill("写真集待保存草稿");
  await page.getByRole("button", { name: "关联模特 林夏", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(1);
  await expect(name).toBeDisabled();
  await expect(page.getByRole("button", { name: "关联模特 林夏", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "添加写真", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__editingRelease(true));
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("无法保存");
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("写真集待保存草稿");
  await expect(page.getByRole("button", { name: "关联模特 林夏", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editingWrites.length)).toBe(2);
  await page.evaluate(() => (window as any).__editingRelease());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__editingWrites[1].op.album);
  expect(saved.name).toBe("写真集待保存草稿");
  expect(saved.modelIds).toEqual(["m0"]);
});
