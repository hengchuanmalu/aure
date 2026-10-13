import { expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  catalogSnapshot,
  connectNative,
  invokeNative,
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
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let guarded = false;
try {
  expect(await page.locator("script[type=module]").getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  expect(await page.getByRole("dialog").count()).toBe(0);
  await page.evaluate((recent) => {
    const originalFetch = window.fetch;
    window.__coverAudit = {
      originalFetch,
      history: [],
      blocked: [],
      probe: true,
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
        if (command === "catalog_view" && window.__coverAudit.probe)
          return new Response(JSON.stringify({ guardVerified: true }), {
            headers,
          });
        if (command === "catalog_recent") {
          window.__coverAudit.history.push(options.body);
          return new Response(JSON.stringify(recent), { headers });
        }
        if (
          [
            "catalog_operation",
            "catalog_patch",
            "catalog_restore_recent",
          ].includes(command)
        ) {
          window.__coverAudit.blocked.push(command);
          return new Response("null", { headers });
        }
      }
      return originalFetch(input, options);
    };
  }, recent);
  expect(
    (await invokeNative(page, "catalog_view", { query: { route: "home" } }))
      .guardVerified,
  ).toBe(true);
  guarded = true;
  await page.evaluate(() => {
    window.__coverAudit.probe = false;
    location.hash = "#/models";
  });
  const cards = page.locator(".models-grid .model-card");
  await expect(cards.first()).toBeVisible();
  const preview = page.locator(".model-cover-preview");
  await cards.first().locator("strong").hover();
  await page.waitForTimeout(250);
  await expect(preview).toHaveCount(0);
  const results = [];
  for (let i = 0; i < (await cards.count()); i++) {
    // Take each baseline after the preceding collapse transition settles.
    await page.waitForTimeout(300);
    const modelHref = await cards.nth(i).getAttribute("href");
    const card = page.locator(`.models-grid .model-card[href="${modelHref}"]`);
    const id = modelHref.split("/").pop();
    const ids = await invokeNative(page, "catalog_model_albums", { id });
    if (!ids.length) continue;
    const beforeBoxes = await page
      .locator(".models-grid > [data-grid-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return {
            id: node.getAttribute("data-grid-id"),
            x: r.x,
            y: r.y,
            width: r.width,
          };
        }),
      );
    const avatar = card.locator(".model-cover-preview-trigger");
    await avatar.hover();
    await expect(preview.locator("a")).toHaveCount(Math.min(3, ids.length));
    await expect(preview.locator('[data-photo-state="ready"]')).toHaveCount(
      Math.min(3, ids.length),
    );
    await page.waitForTimeout(350);
    await expect(preview.locator("img")).toHaveCount(Math.min(3, ids.length));
    await expect(
      page.locator('.model-preview-group[data-expanded="true"]'),
    ).toHaveAttribute("data-model-preview-id", id);
    const names = await preview
      .locator("img")
      .evaluateAll((images) => images.map((image) => image.alt));
    console.log(
      JSON.stringify({
        modelIndex: i,
        albumCount: ids.length,
        previewCount: names.length,
      }),
    );
    for (const name of names) {
      const owners = db
        .prepare(
          "SELECT id FROM entities WHERE kind='albums' AND json_extract(data,'$.name')=?",
        )
        .all(name)
        .map((row) => row.id);
      expect(owners.some((owner) => ids.includes(owner))).toBe(true);
    }
    const coverBounds = await preview.locator("a").first().boundingBox();
    const avatarBounds = await avatar.boundingBox();
    expect(coverBounds.x).toBeGreaterThan(avatarBounds.x + avatarBounds.width);
    expect(Math.abs(coverBounds.y - avatarBounds.y)).toBeLessThan(2);
    const contentBounds = await page.locator(".page-content").boundingBox();
    const previewBounds = await preview.boundingBox();
    expect(previewBounds.x + previewBounds.width).toBeLessThanOrEqual(
      contentBounds.x + contentBounds.width,
    );
    const afterBoxes = await page
      .locator(".models-grid > [data-grid-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return {
            id: node.getAttribute("data-grid-id"),
            x: r.x,
            y: r.y,
            width: r.width,
          };
        }),
      );
    const reflowed = afterBoxes.some((box) => {
      const previous = beforeBoxes.find((before) => before.id === box.id);
      return (
        Math.abs(box.x - previous.x) > 1 || Math.abs(box.y - previous.y) > 1
      );
    });
    const expandedBox = afterBoxes.find((box) => box.id === id);
    const originalBox = beforeBoxes.find((box) => box.id === id);
    expect(expandedBox.width).toBeGreaterThan(originalBox.width);
    if (i < afterBoxes.length - 1) expect(reflowed).toBe(true);
    if (expandedBox.y > originalBox.y + 50 && i < beforeBoxes.length - 1) {
      const filled = afterBoxes.find((box) => box.id === beforeBoxes[i + 1].id);
      expect(Math.abs(filled.x - originalBox.x)).toBeLessThan(2);
      expect(Math.abs(filled.y - originalBox.y)).toBeLessThan(2);
    }
    await page.mouse.move(
      coverBounds.x + coverBounds.width / 2,
      coverBounds.y + coverBounds.height / 2,
      { steps: 12 },
    );
    await page.waitForTimeout(300);
    expect(
      await preview
        .locator("img")
        .evaluateAll((images) => images.map((image) => image.alt)),
    ).toEqual(names);
    if (i === 0) {
      const hrefs = await preview
        .locator("a")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(500);
      expect(
        await preview
          .locator("a")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("href")),
          ),
      ).toEqual(hrefs);
    }
    results.push({
      albumCount: ids.length,
      previewCount: names.length,
      rightAligned: true,
      reflowed,
    });
    if (ids.length > 3 && !results.some((result) => result.screenshot)) {
      await mkdir("verification/model-cover-preview", { recursive: true });
      await page.screenshot({
        path: "verification/model-cover-preview/installed.png",
      });
      results.at(-1).screenshot = true;
    }
    await page.mouse.move(100, 100);
    await expect(preview).toHaveCount(0);
  }
  await cards.first().locator(".model-cover-preview-trigger").hover();
  await expect(preview.locator("a").first()).toBeVisible();
  await page.waitForTimeout(300);
  const link = preview.locator("a").first();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(href.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
  );
  await page.getByRole("button", { name: "返回模特", exact: true }).click();
  await expect(cards.first()).toBeVisible();
  await page.mouse.move(100, 100);
  await cards.first().locator(".model-cover-preview-trigger").hover();
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.mouse.move(100, 100);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await cards.first().locator(".model-cover-preview-trigger").hover();
  await expect(preview).toBeVisible();
  await page.mouse.move(100, 100);
  await expect(preview).toHaveCount(0);
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const audit = await page.evaluate(() => ({
    history: window.__coverAudit.history.length,
    blocked: window.__coverAudit.blocked,
  }));
  expect(audit.history).toBeGreaterThan(0);
  expect(audit.blocked).toEqual([]);
  const report = {
    results,
    albumClickAndReturn: true,
    gapsBackfilled: true,
    historyWritesIntercepted: audit.history,
    catalogUnchanged: true,
    errors,
    frontendEntry: receipt.FrontendEntry,
    executableHash: receipt.ExecutableHash,
  };
  await writeFile(
    "verification/model-cover-preview/installed.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (
    originalHash === "#/models" ||
    originalHash === "#/" ||
    originalHash === ""
  )
    await page.evaluate((hash) => {
      location.hash = hash;
    }, originalHash);
  if (guarded)
    await page.evaluate(() => {
      window.fetch = window.__coverAudit.originalFetch;
      delete window.__coverAudit;
    });
  db.close();
  await browser.close();
}
