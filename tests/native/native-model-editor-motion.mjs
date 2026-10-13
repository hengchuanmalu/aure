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
import { verifyModelEditorMotion } from "../support/model-editor-motion.mjs";

const receipt = await readInstalledBuild();
const db = new DatabaseSync(
  join(process.env.APPDATA, "local.jingji.desktop", "catalog.sqlite3"),
  { readOnly: true },
);
const before = catalogSnapshot(db);
const models = db
  .prepare("SELECT data FROM entities WHERE kind='models'")
  .all()
  .map((row) => JSON.parse(row.data));
const model =
  models.find((model) => model.avatar && model.background) || models[0];
if (!model) throw Error("需要一个现有模特资料进行只读验收");
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
const originalRoute = await page.evaluate(() => location.hash);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  expect(await page.locator("script[type=module]").getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  await page.evaluate((id) => {
    location.hash = `/models/${id}`;
  }, model.id);
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  const columns = await verifyModelEditorMotion(page);
  const output = "verification/model-editor-motion-installed";
  await mkdir(output, { recursive: true });
  await page
    .locator(".model-editor-tabs")
    .getByRole("button", { name: "背景图片", exact: true })
    .click();
  await expect(page.locator('[data-panel-present="true"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({ path: `${output}/background.png` });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await verifyModelEditorMotion(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = {
    engine: "installed Windows WebView2",
    frontendEntry: receipt.FrontendEntry,
    executableHash: receipt.ExecutableHash,
    columns,
    reducedMotion: true,
    rapidSwitches: true,
    catalogUnchanged: true,
    errors,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => {});
  await page
    .getByRole("dialog", { name: "编辑资料" })
    .getByRole("button", { name: "取消", exact: true })
    .click({ timeout: 2000 })
    .catch(() => {});
  await page
    .evaluate((hash) => {
      location.hash = hash;
    }, originalRoute)
    .catch(() => {});
  db.close();
  await browser.close();
}
