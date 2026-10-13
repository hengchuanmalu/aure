import { expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
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
const recent = db
  .prepare("SELECT * FROM recent ORDER BY at DESC")
  .all()
  .map((row) => ({
    albumId: row.album,
    ...(row.media ? { mediaId: row.media } : {}),
    at: row.at,
  }));
const album = db
  .prepare("SELECT album AS id FROM summaries WHERE images>0 LIMIT 1")
  .get();
const model = db
  .prepare("SELECT id FROM entities WHERE kind='models' LIMIT 1")
  .get();
const image = db
  .prepare(
    "SELECT e.id FROM entities e JOIN refs r ON r.target=e.id WHERE e.kind='media' AND e.media_kind='image' AND r.owner_kind='albums' AND r.role='content' AND r.owner=? LIMIT 1",
  )
  .get(album.id);
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
const original = await page.evaluate(() => ({
  hash: location.hash,
  scroll: scrollY,
}));
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));

// Installed acceptance reads the real catalog. History requests are observed,
// answered with the unchanged history, and never reach the native write command.
function installGuard(recent) {
  const originalFetch = window.fetch;
  window.__firstEntryAudit = {
    originalFetch,
    reads: [],
    history: [],
    probe: false,
    missingModel: false,
  };
  window.fetch = async (input, options) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      location.href,
    );
    if (url.hostname === "ipc.localhost") {
      const command = decodeURIComponent(url.pathname.slice(1));
      const headers = {
        "Content-Type": "application/json",
        "Tauri-Response": "ok",
      };
      if (command === "catalog_view" && window.__firstEntryAudit.probe)
        return new Response(JSON.stringify({ guardVerified: true }), {
          headers,
        });
      if (command === "catalog_recent") {
        // Never throw here: an IPC fetch rejection could trigger Tauri's
        // postMessage fallback and accidentally execute a real history write.
        let args = { entry: { unparsedRequest: true } };
        try {
          args = JSON.parse(options.body);
        } catch {
          /* still block the write */
        }
        window.__firstEntryAudit.history.push(args.entry);
        return new Response(JSON.stringify(recent), { headers });
      }
      if (command === "catalog_entity" && window.__firstEntryAudit.missingModel)
        return new Response("null", { headers });
      if (
        [
          "catalog_patch",
          "catalog_operation",
          "catalog_reset",
          "catalog_restore_recent",
        ].includes(command)
      )
        return new Response(
          JSON.stringify("Read-only first-entry acceptance"),
          { headers: { ...headers, "Tauri-Response": "error" } },
        );
      if (command === "catalog_view") {
        const read = {
          query: JSON.parse(options.body).query,
          completed: false,
        };
        window.__firstEntryAudit.reads.push(read);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const response = await originalFetch.call(window, input, options);
        read.completed = true;
        return response;
      }
    }
    return originalFetch.call(window, input, options);
  };
}
try {
  expect(await page.locator('script[type="module"]').getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  await page.evaluate(installGuard, recent);
  await page.evaluate(() => (window.__firstEntryAudit.probe = true));
  const probe = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("catalog_view", {
      query: { route: "home" },
    }),
  );
  expect(probe.guardVerified).toBe(true);
  await page.evaluate(() => (window.__firstEntryAudit.probe = false));
  async function coldRoute(route, surface) {
    await page.evaluate(() => (location.hash = "/settings"));
    await page.reload();
    await expect(page.locator(".settings-page")).toBeVisible();
    // WebView2 reloads discard the guard; establish and verify it while the
    // settings page is active, before navigating to any history-writing route.
    await page.evaluate(installGuard, recent);
    await page.evaluate(() => (window.__firstEntryAudit.probe = true));
    const probe = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("catalog_view", {
        query: { route: "home" },
      }),
    );
    expect(probe.guardVerified).toBe(true);
    await page.evaluate(() => (window.__firstEntryAudit.probe = false));
    await page.evaluate((route) => (location.hash = route), route);
    if (route !== "/settings")
      await page.waitForFunction(() => {
        const read = window.__firstEntryAudit.reads.at(-1);
        return read?.completed && read.query.route !== "settings";
      });
    await expect(page.locator(surface).first()).toBeVisible();
  }
  for (const [route, heading, surface] of [
    ["/", "发现", ".discovery"],
    ["/library", "写真库", ".album-grid"],
    ["/tags", "标签", ".tag-browse-filters"],
    ["/models", "模特", ".models-page"],
    ["/favorites", "收藏", ".page-content .page-pad"],
    ["/recent", "最近浏览", ".page-content .page-pad"],
    ["/tags/manage", "标签", ".tag-group"],
  ]) {
    await coldRoute(route, surface);
    await expect(page.locator("h1")).toHaveText(heading);
    await page.waitForFunction(
      (route) =>
        window.__firstEntryAudit.reads.some(
          (read) => read.query.route === route && read.completed,
        ),
      route === "/"
        ? "home"
        : route === "/tags/manage"
          ? "tags"
          : route === "/tags"
            ? "library"
            : route.slice(1),
    );
    if (route === "/library" || route === "/tags") {
      await page.getByRole("button", { name: "排序", exact: true }).click();
      await expect(page.getByRole("menu", { name: "排序选项" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "封面视图", exact: true }).click();
      await expect(page.locator(".album-card--cover").first()).toBeVisible();
    }
    if (route === "/models") {
      await page.locator(".model-index-zone").hover();
      await expect(page.locator(".model-index")).toHaveCSS("opacity", "1");
      await page.locator(".model-index button:not(:disabled)").first().click();
      await expect(
        page.locator('.model-index button[aria-pressed="true"]'),
      ).toHaveCount(1);
    }
    if (route === "/favorites") {
      const mediaTab = page.getByRole("button", { name: /^照片与视频/ });
      await mediaTab.click();
      await expect(mediaTab).toHaveAttribute("aria-pressed", "true");
    }
    if (route === "/tags/manage") {
      await page
        .locator(".topbar")
        .getByRole("button", { name: "添加标签", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "标签名称" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "标签分类", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "标签分类选项" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
    checks.push({
      route,
      coldSnapshot: true,
      firstAction: [
        "/library",
        "/tags",
        "/models",
        "/favorites",
        "/tags/manage",
      ].includes(route),
    });
  }
  await coldRoute(`/album/${encodeURIComponent(album.id)}`, ".album-hero");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__firstEntryAudit.history.filter(Boolean).length,
      ),
    )
    .toBe(1);
  checks.push({
    route: "album",
    firstRecentRequest: true,
    writeIntercepted: true,
  });

  if (model) {
    await coldRoute(`/models/${encodeURIComponent(model.id)}`, ".model-hero");
    await page.evaluate(() => (window.__firstEntryAudit.missingModel = true));
    await page.getByRole("button", { name: "编辑资料", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("资料已不存在");
    await expect(page.getByLabel("模特名称", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window.__firstEntryAudit.missingModel = false));
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByLabel("模特名称", { exact: true })).toBeVisible();
    await page
      .locator(".model-editor-tabs")
      .getByRole("button", { name: "模特头像", exact: true })
      .click();
    await expect(page.locator(".avatar-editor")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    checks.push({
      route: "model",
      firstEditorAndTab: true,
      missingEntityRecovery: true,
    });
  }
  if (image) {
    await coldRoute(
      `/viewer/${encodeURIComponent(album.id)}/${encodeURIComponent(image.id)}`,
      ".viewer",
    );
    await expect(
      page.getByRole("button", { name: "返回详情", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".media-stage")).toHaveAttribute(
      "data-media-state",
      "ready",
    );
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest(".viewer")),
    ).toBe(true);
    // The focused control may own a tooltip's Escape layer; use the actual
    // return action after verifying the first keyboard focus move.
    await page.getByRole("button", { name: "返回详情", exact: true }).click();
    await expect(page.locator(".viewer")).toHaveCount(0);
    checks.push({
      route: "viewer",
      firstFocus: true,
      imageReady: true,
      firstKeyboardAction: true,
    });
  }
  await coldRoute("/settings", ".settings-page");
  await page.getByRole("button", { name: "高级设置", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeVisible();
  checks.push({ route: "settings", firstTab: true });
  expect(errors).toEqual([]);
} finally {
  await page.evaluate((original) => (location.hash = original.hash), original);
  await page.waitForTimeout(700);
  await page.evaluate((scroll) => {
    scrollTo(0, scroll);
    if (window.__firstEntryAudit)
      window.fetch = window.__firstEntryAudit.originalFetch;
    delete window.__firstEntryAudit;
  }, original.scroll);
  expect(catalogSnapshot(db)).toBe(before);
  db.close();
  await browser.close();
}
const result = { receipt, checks, catalogUnchanged: true, errors };
await writeFile(
  "verification/first-entry-installed.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
