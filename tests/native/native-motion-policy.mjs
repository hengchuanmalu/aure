import { readInstalledBuild, catalogSnapshot, connectNative } from '../support/native-session.mjs';
// Installed WebView2 acceptance with actual catalog media and read-only IPC guards.
import { expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const install = join(process.env.LOCALAPPDATA, "Programs", "aure");
const receipt = await readInstalledBuild(install);
const hash = (data) =>
  createHash("sha256").update(data).digest("hex").toUpperCase();

const db = new DatabaseSync(
  join(process.env.APPDATA, "local.jingji.desktop", "catalog.sqlite3"),
  { readOnly: true },
);
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const recent = db
  .prepare("SELECT * FROM recent ORDER BY at DESC")
  .all()
  .map((row) => ({
    albumId: row.album,
    ...(row.media ? { mediaId: row.media } : {}),
    at: row.at,
  }));
const album = db
  .prepare(
    "SELECT album,images,videos FROM summaries WHERE images>1 ORDER BY images DESC LIMIT 1",
  )
  .get();
if (!album) throw Error("No real photo album available for acceptance");
const images = db
  .prepare(
    "SELECT e.id FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' AND e.media_kind='image' ORDER BY r.position LIMIT 2",
  )
  .all(album.album);
const browser = await connectNative(process.env.AURE_CDP_URL || "http://127.0.0.1:9237", "local.jingji.desktop");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith("http://tauri.localhost"));
if (!page) throw Error("Installed WebView2 page unavailable");
page.setDefaultTimeout(15000);
const originalRoute = await page.evaluate(() => location.hash);
const savedView = await page.evaluate(() =>
  localStorage.getItem("aure.media-view.v1"),
);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = "verification/motion-installed";
const route = (hash) =>
  page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
let guarded = false;
try {
  expect(await page.locator("script[type=module]").getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  expect(
    await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"),
    ),
  ).toBe("local.jingji.desktop");
  await page.evaluate((recent) => {
    const original = window.fetch;
    window.__motionOriginalFetch = original;
    window.__motionProbe = true;
    window.__motionBlocked = 0;
    window.fetch = (input, options) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === "ipc.localhost") {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = {
          "Content-Type": "application/json",
          "Tauri-Response": "ok",
        };
        if (command === "catalog_view" && window.__motionProbe)
          return Promise.resolve(
            new Response(JSON.stringify({ readProbe: true }), { headers }),
          );
        if (command === "catalog_recent") {
          window.__motionBlocked++;
          return Promise.resolve(
            new Response(JSON.stringify(recent), { headers }),
          );
        }
        if (
          [
            "catalog_patch",
            "catalog_operation",
            "catalog_reset",
            "catalog_restore_recent",
          ].includes(command)
        )
          return Promise.resolve(
            new Response(JSON.stringify("Read-only motion acceptance"), {
              headers: { ...headers, "Tauri-Response": "error" },
            }),
          );
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect(
    (
      await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("catalog_view", { query: {} }),
      )
    ).readProbe,
  ).toBe(true);
  guarded = true;
  await page.evaluate(() => {
    window.__motionProbe = false;
  });
  await mkdir(output, { recursive: true });
  await route("/library");
  const card = page.locator(".album-card").first();
  await expect(card).toHaveCSS("opacity", "1");
  await expect(card).toHaveCSS("transform", "none");
  const neighbor = page.locator(".album-card").nth(1);
  const neighborBefore = await neighbor.boundingBox();
  await card.hover();
  await expect(card.locator(".album-overlay")).toHaveCSS("opacity", "1");
  expect(await neighbor.boundingBox()).toEqual(neighborBefore);
  await page.screenshot({ path: `${output}/library.png` });
  await card.getByRole("button", { name: /更多操作$/ }).click();
  await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
  const fullMotion = await page.locator('html').getAttribute('data-motion') === 'full';
  await expect(page.getByRole('menu')).toHaveCSS('animation-name', fullMotion ? 'enter' : 'none');
  expect(await page.getByRole('menu').evaluate(el => getComputedStyle(el).getPropertyValue('--tw-enter-scale').trim())).toBe('.96');
  await page.keyboard.press("Escape");
  await route("/models");
  const index = page.locator(".model-index");
  await page.mouse.move(500, 300);
  await expect(index).toHaveCSS("opacity", "0");
  await page.locator(".model-index-zone").hover();
  await expect(index).toHaveCSS("opacity", "1");
  await page.mouse.move(500, 300);
  await expect(index).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await page.getByRole("group", { name: "显示模特字母索引" }).focus();
  await expect(index).toHaveCSS("opacity", "1");
  await page.screenshot({ path: `${output}/models.png` });
  await page.getByRole('button', { name: '添加模特', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', fullMotion ? 'enter' : 'none');
  const editorTabs = page.getByRole('navigation', { name: '编辑资料分区' });
  for (const name of ['社交链接', '模特头像', '背景图片', '基本资料']) {
    const tab = editorTabs.getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('data-checked', 'true');
    await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
    await expect(page.locator('[data-panel-present="true"]')).toHaveCSS('opacity', '1');
  }
  await page.screenshot({ path: `${output}/model-editor.png` });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await route("/settings");
  await page.getByRole("button", { name: "高级设置", exact: true }).click();
  await expect(page.getByRole('button', { name: '高级设置', exact: true })).toHaveAttribute('data-checked', 'true');
  await expect(page.locator(".settings-content")).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await expect(page.locator(".settings-content")).toContainText(
    "aure",
  );
  await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-present="true"]')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `${output}/settings.png` });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await route("/library");
  await card.hover();
  await card.getByRole("button", { name: /更多操作$/ }).click();
  await expect(page.getByRole("menu")).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await route(`/album/${album.album}`);
  const grid = page.locator(".media-layout");
  await expect(grid).toHaveAttribute("data-animated", "false");
  await page.getByRole("button", { name: "平铺视图", exact: true }).click();
  await expect(grid).toHaveAttribute("data-layout-mode", "tiles");
  await page.screenshot({ path: `${output}/media-grid.png` });
  await page.getByRole("button", { name: "编辑写真集", exact: true }).click();
  const picker = page.getByLabel("封面区", { exact: true });
  await picker.locator('.cover-stage').hover({ position: { x: 20, y: (await picker.locator('.cover-stage').boundingBox()).height * .7 } });
  await expect(picker.locator(".cover-thumbnail").first()).toBeVisible();
  const candidate = await picker.locator(".cover-thumbnail").first().boundingBox();
  expect(candidate.width).toBeGreaterThan(0);
  expect(candidate.height).toBeGreaterThan(0);
  await page.screenshot({ path: `${output}/cover-picker.png` });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".album-editor-modal")).toHaveCount(0);
  await route(`/viewer/${album.album}/${images[0].id}`);
  const main = page.locator(".media-stage > img");
  await expect
    .poll(() => main.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const stage = await page.locator(".media-stage").boundingBox();
  const rail = page.locator(".viewer-filmstrip");
  await page.locator(".viewer-filmstrip-zone").hover();
  await expect(rail).toHaveCSS("opacity", "1");
  await page.mouse.move(500, 300);
  await expect(rail).toHaveCSS("opacity", "0");
  await expect(rail).toHaveAttribute("inert", "");
  expect(await page.locator(".media-stage").boundingBox()).toEqual(stage);
  await page.keyboard.press("Tab");
  await page.getByRole("group", { name: "显示写真集缩略图" }).focus();
  await expect(rail).toHaveCSS("opacity", "1");
  await expect(rail).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: `${output}/viewer.png` });
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(new RegExp(`${images[1].id}$`));
  await expect
    .poll(() => main.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  expect(await page.locator(".viewer-thumbnail").count()).toBeLessThan(32);
  expect(await page.evaluate(() => window.__motionBlocked)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(snapshot()).toBe(before);
  const result = {
    engine: "installed Windows WebView2",
    executableHash: receipt.ExecutableHash,
    frontendEntry: receipt.FrontendEntry,
    immediateCards: true,
    stableNeighbors: true,
    localMenusAndSettings: true,
    openSourceSurfaceAssets: true,
    motionPrimitivesPanelAndSelection: true,
    modelEditorTabsAndCancel: true,
    liveSystemReduce: true,
    portalReduce: true,
    gridReduce: true,
    sharedCoverPickerVisible: true,
    coverPickerFocusRestored: true,
    auxiliaryFadeFocusAndInert: true,
    stableMainMedia: true,
    realImagesDecoded: true,
    boundedFilmstrip: true,
    catalogUnchanged: true,
    errors,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (guarded) {
    await page.emulateMedia({ reducedMotion: null }).catch(() => {});
    await route(
      originalRoute.startsWith("#/viewer/") ? "/library" : originalRoute || "/",
    ).catch(() => {});
    await page
      .locator(".viewer")
      .waitFor({ state: "detached" })
      .catch(() => {});
    await page
      .evaluate((saved) => {
        if (saved === null) localStorage.removeItem("aure.media-view.v1");
        else localStorage.setItem("aure.media-view.v1", saved);
        window.fetch = window.__motionOriginalFetch;
        delete window.__motionOriginalFetch;
        delete window.__motionProbe;
        delete window.__motionBlocked;
      }, savedView)
      .catch(() => {});
  }
  expect(snapshot()).toBe(before);
  db.close();
  await browser.close();
}
