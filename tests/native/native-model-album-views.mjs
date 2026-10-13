import {
  readInstalledBuild,
  catalogSnapshot,
  connectNative,
  nativePage,
} from "../support/native-session.mjs";
import { expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Only presentation state changes; the installed catalog is opened read-only.
const receipt = await readInstalledBuild();
const db = new DatabaseSync(
  join(process.env.APPDATA, "local.jingji.desktop", "catalog.sqlite3"),
  { readOnly: true },
);
const before = catalogSnapshot(db);
const model = db
  .prepare(
    "SELECT target AS id, COUNT(*) AS total FROM refs WHERE owner_kind='albums' AND target_kind='models' GROUP BY target ORDER BY total DESC LIMIT 1",
  )
  .get();
if (!model) throw Error("No linked model in the installed catalog");
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = "verification/model-album-views-installed";
try {
  expect(await page.locator("script[type=module]").getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  await page.goto(`http://tauri.localhost/#/models/${model.id}`);
  const section = page.getByRole("region", { name: "关联写真集", exact: true });
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(
    `关联写真集 · ${model.total}`,
  );
  await page.mouse.wheel(0, -100000);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  await section.getByRole("heading", { level: 2 }).scrollIntoViewIfNeeded();
  await expect(section.locator(".album-card--stack").first()).toBeVisible();
  await expect(
    section.locator(".fan-front .photo-frame").first(),
  ).toHaveAttribute("data-photo-state", "ready");
  await mkdir(output, { recursive: true });
  const animations = [];
  for (const target of ["cover", "stack"]) {
    const widths = await section.evaluate((section, target) => {
      const card = section.querySelector(".album-card");
      const frame = card.querySelector(".fan-front-layout");
      const image = card.querySelector(".fan-front img");
      const before = frame.getBoundingClientRect().width;
      const frames = [],
        start = performance.now();
      section
        .querySelector(
          `button[aria-label="${target === "cover" ? "封面视图" : "叠放视图"}"]`,
        )
        .click();
      return new Promise((resolve) => {
        const sample = () => {
          const rect = image.getBoundingClientRect();
          frames.push({
            width: frame.getBoundingClientRect().width,
            same: card.querySelector(".fan-front img") === image,
            ratio: rect.width / rect.height,
          });
          if (performance.now() - start < 600) requestAnimationFrame(sample);
          else
            resolve({
              before,
              frames,
              reduced: document.documentElement.dataset.motion === "reduced",
            });
        };
        requestAnimationFrame(sample);
      });
    }, target);
    expect(widths.frames.every((frame) => frame.same)).toBe(true);
    for (const frame of widths.frames)
      expect(frame.ratio).toBeCloseTo(widths.frames.at(-1).ratio, 1);
    const interpolated = widths.frames.some(
      (frame) =>
        Math.abs(frame.width - widths.before) > 3 &&
        Math.abs(frame.width - widths.frames.at(-1).width) > 3,
    );
    if (!widths.reduced) expect(interpolated).toBe(true);
    animations.push({ target, interpolated, reduced: widths.reduced });
    await expect(
      section.locator(`.album-card--${target}`).first(),
    ).toBeVisible();
    await expect(section.locator(".fan-front-layout").first()).toHaveCSS(
      "transform",
      "none",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${output}/${target}.png` });
  }
  await section.getByRole("button", { name: "封面视图", exact: true }).click();
  await page.reload();
  await expect(
    section.getByRole("button", { name: "封面视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(section.locator(".album-card--cover").first()).toBeVisible();
  await page.mouse.wheel(0, -100000);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  await section.getByRole("button", { name: "叠放视图", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(section.locator("[data-grid-id]").first()).toHaveCSS(
    "transform",
    "none",
  );
  await expect(section.locator(".fan-front-layout").first()).toHaveCSS(
    "transform",
    "none",
  );
  await page.evaluate(() => scrollTo(0, 1600));
  await page.waitForTimeout(250);
  const anchor = await page.evaluate(() => {
    const node = [...document.querySelectorAll("[data-grid-id]")].find(
      (node) => node.getBoundingClientRect().bottom > 120,
    );
    window.__modelViewAnchor = node.querySelector(".fan-front img");
    return { id: node.dataset.gridId, top: node.getBoundingClientRect().top };
  });
  for (const label of ["封面视图", "叠放视图"]) {
    await page.evaluate(
      (label) =>
        document.querySelector(`button[aria-label="${label}"]`).click(),
      label,
    );
    await page.waitForTimeout(500);
    const position = await page
      .locator(`[data-grid-id="${anchor.id}"]`)
      .evaluate((node) => ({
        top: node.getBoundingClientRect().top,
        same: node.querySelector(".fan-front img") === window.__modelViewAnchor,
      }));
    expect(position.same).toBe(true);
    expect(Math.abs(position.top - anchor.top)).toBeLessThanOrEqual(1);
    expect(await section.locator("[data-grid-id]").count()).toBeLessThan(80);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.evaluate(() => scrollTo(0, 0));
  await section.getByRole("button", { name: "封面视图", exact: true }).click();
  await expect(section.locator(".fan-front-layout").first()).toHaveCSS(
    "transform",
    "none",
  );
  await expect(section.locator(".fan-photo-plane").first()).toHaveCSS(
    "transform",
    "none",
  );
  await section.getByRole("button", { name: "叠放视图", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = {
    engine: "installed Windows WebView2",
    executableHash: receipt.ExecutableHash,
    frontendEntry: receipt.FrontendEntry,
    linkedAlbums: model.total,
    animations,
    reloadPreservesView: true,
    scrollAnchorPreserved: true,
    reducedMotion: true,
    catalogUnchanged: true,
    errors,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: null });
  db.close();
  await browser.close();
}
