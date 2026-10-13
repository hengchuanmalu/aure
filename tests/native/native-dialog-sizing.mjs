import { expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  catalogSnapshot,
  connectNative,
  nativePage,
  readInstalledBuild,
} from "../support/native-session.mjs";

const receipt = await readInstalledBuild();
const db = new DatabaseSync(
  join(process.env.APPDATA, "local.jingji.desktop", "catalog.sqlite3"),
  { readOnly: true },
);
const before = catalogSnapshot(db);
const model = JSON.parse(
  db.prepare("SELECT data FROM entities WHERE kind='models' LIMIT 1").get()
    .data,
);
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
const originalRoute = await page.evaluate(() => location.hash);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const width = async (locator) => (await locator.boundingBox()).width;
try {
  expect(await page.locator("script[type=module]").getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  await page.evaluate((id) => {
    location.hash = `/models/${id}`;
  }, model.id);
  await page.getByRole("button", { name: "编辑资料", exact: true }).waitFor();
  // Delay a read without changing its result, so the loading surface is measurable.
  await page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__;
    window.__dialogSizingInvoke = internals.invoke;
    internals.invoke = async function (command, args, ...rest) {
      if (command === "catalog_entity" && args?.kind === "models")
        await new Promise((resolve) => setTimeout(resolve, 1200));
      return window.__dialogSizingInvoke.call(
        internals,
        command,
        args,
        ...rest,
      );
    };
  });
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await expect(page.getByText("正在读取资料…", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  const loadingWidth = await width(page.getByRole("dialog"));
  await expect(page.getByLabel("模特名称", { exact: true })).toBeVisible();
  const editorWidth = await width(page.getByRole("dialog"));
  expect(editorWidth).toBeCloseTo(loadingWidth, 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => {
    location.hash = "/library?create=1";
  });
  await expect(
    page.getByRole("button", { name: "从文件夹导入", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  const albumWidth = await width(page.getByRole("dialog"));
  expect(albumWidth).toBeCloseTo(editorWidth, 0);
  await page.getByRole("button", { name: "添加新模特", exact: true }).click();
  const modelDraft = page.getByRole("dialog", { name: "添加模特" });
  await expect(modelDraft).toHaveCSS("opacity", "1");
  expect(await width(modelDraft)).toBeCloseTo(albumWidth, 0);
  await modelDraft
    .getByLabel("模特名称", { exact: true })
    .fill("仅供取消的验收草稿");
  await modelDraft.getByRole("button", { name: "取消", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toHaveCSS("opacity", "1");
  const compactWidth = await width(confirmation);
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.evaluate(() => {
    location.hash = "/tags/manage";
  });
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  expect(await width(page.getByRole("dialog"))).toBeCloseTo(compactWidth, 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .locator(".topbar")
    .getByRole("button", { name: "添加标签", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  expect(await width(page.getByRole("dialog"))).toBeCloseTo(compactWidth, 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = {
    engine: "installed Windows WebView2",
    frontendEntry: receipt.FrontendEntry,
    executableHash: receipt.ExecutableHash,
    loadingWidth,
    editorWidth,
    albumWidth,
    compactWidth,
    nestedEditor: true,
    catalogUnchanged: true,
    errors,
  };
  await mkdir("verification/dialog-sizing-installed", { recursive: true });
  await writeFile(
    "verification/dialog-sizing-installed/results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page
    .evaluate(() => {
      if (window.__dialogSizingInvoke) {
        window.__TAURI_INTERNALS__.invoke = window.__dialogSizingInvoke;
        delete window.__dialogSizingInvoke;
      }
    })
    .catch(() => {});
  await page
    .evaluate((hash) => {
      location.hash = hash;
    }, originalRoute)
    .catch(() => {});
  db.close();
  await browser.close();
}
