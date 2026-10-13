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
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
page.setDefaultTimeout(15000);
const original = await page.evaluate(() => ({
  hash: location.hash,
  scroll: scrollY,
}));
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const recent = db
  .prepare("SELECT * FROM recent ORDER BY at DESC")
  .all()
  .map((row) => ({
    albumId: row.album,
    ...(row.media ? { mediaId: row.media } : {}),
    at: row.at,
  }));

function installGuard(recent) {
  const originalFetch = window.fetch;
  window.__collectionViewAudit = { probe: false, originalFetch };
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
      if (command === "catalog_view" && window.__collectionViewAudit.probe)
        return new Response(JSON.stringify({ guardVerified: true }), {
          headers,
        });
      if (command === "catalog_recent")
        return new Response(JSON.stringify(recent), { headers });
      if (
        [
          "catalog_patch",
          "catalog_operation",
          "catalog_reset",
          "catalog_restore_recent",
        ].includes(command)
      )
        return new Response(
          JSON.stringify("Read-only collection view acceptance"),
          { headers: { ...headers, "Tauri-Response": "error" } },
        );
    }
    return originalFetch.call(window, input, options);
  };
}

async function verifyGuard() {
  await page.evaluate(() => (window.__collectionViewAudit.probe = true));
  expect(
    await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("catalog_view", {
        query: { route: "home" },
      }),
    ),
  ).toEqual({ guardVerified: true });
  await page.evaluate(() => (window.__collectionViewAudit.probe = false));
}

const output = "verification/collection-album-views-installed";
const checks = [];
try {
  expect(await page.locator('script[type="module"]').getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  await page.addInitScript(installGuard, recent);
  await page.evaluate(installGuard, recent);
  await verifyGuard();
  await mkdir(output, { recursive: true });
  for (const route of ["favorites", "recent"]) {
    await page.evaluate((route) => {
      location.hash = `#/${route}`;
      scrollTo(0, 0);
    }, route);
    await expect(
      page.getByRole("heading", {
        name: route === "favorites" ? "收藏" : "最近浏览",
        exact: true,
      }),
    ).toBeVisible();
    const stack = page.getByRole("button", { name: "叠放视图", exact: true });
    const cover = page.getByRole("button", { name: "封面视图", exact: true });
    await expect(stack).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(350);
    const count = await page.locator(".album-card").count();
    const total = count
      ? await page.locator(".album-grid").getAttribute("data-total-items")
      : null;
    for (const target of ["cover", "stack"]) {
      const widths = count
        ? await page.evaluate((target) => {
            const frame = document.querySelector(".fan-front-layout");
            const widths = [frame.getBoundingClientRect().width];
            const started = performance.now();
            document
              .querySelector(
                `button[aria-label="${target === "cover" ? "封面视图" : "叠放视图"}"]`,
              )
              .click();
            return new Promise((resolve) => {
              const sample = () => {
                widths.push(frame.getBoundingClientRect().width);
                if (performance.now() - started < 450)
                  requestAnimationFrame(sample);
                else resolve(widths);
              };
              requestAnimationFrame(sample);
            });
          }, target)
        : (await (target === "cover" ? cover : stack).click(), []);
      await expect(target === "cover" ? cover : stack).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      if (count) {
        await expect(
          page.locator(`.album-card--${target}`).first(),
        ).toBeVisible();
        await expect(
          page.locator(
            `.album-card--${target === "cover" ? "stack" : "cover"}`,
          ),
        ).toHaveCount(0);
        await expect(page.locator(".album-grid")).toHaveAttribute(
          "data-total-items",
          total,
        );
      }
      if (widths.length)
        expect(
          widths.some(
            (width) =>
              Math.abs(width - widths[0]) > 3 &&
              Math.abs(width - widths.at(-1)) > 3,
          ),
        ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `${output}/${route}-${target}.png` });
    }
    await cover.click();
    await page.reload();
    await verifyGuard();
    await expect(cover).toHaveAttribute("aria-pressed", "true");
    if (count)
      await expect(page.locator(".album-card--cover").first()).toBeVisible();
    if (route === "favorites") {
      await page.getByRole("button", { name: /^照片与视频/ }).click();
      await expect(
        page.getByRole("group", { name: "写真集展示方式" }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: /^写真集 ·/ }).click();
      await expect(cover).toHaveAttribute("aria-pressed", "true");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stack.click();
    if (count)
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    checks.push({
      route,
      renderedAlbums: count,
      reloadPreservesView: true,
      reducedMotion: true,
    });
  }
  await page.evaluate(() => (location.hash = "#/"));
  await expect(page.getByRole("group", { name: "写真集展示方式" })).toHaveCount(
    0,
  );
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = {
    engine: "installed Windows WebView2",
    executableHash: receipt.ExecutableHash,
    frontendEntry: receipt.FrontendEntry,
    checks,
    catalogUnchanged: true,
    errors,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: null });
  await page.evaluate((original) => {
    window.fetch = window.__collectionViewAudit.originalFetch;
    location.hash = original.hash;
    scrollTo(0, original.scroll);
  }, original);
  db.close();
  await browser.close();
}
