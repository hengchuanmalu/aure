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
const beforeCatalog = catalogSnapshot(db);
const browser = await connectNative(
  "http://127.0.0.1:9237",
  "local.jingji.desktop",
);
const page = nativePage(browser);
const original = await page.evaluate(() => ({
  hash: location.hash,
  scroll: scrollY,
}));
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
try {
  expect(await page.locator('script[type="module"]').getAttribute("src")).toBe(
    receipt.FrontendEntry,
  );
  for (const route of ["library", "tags"]) {
    for (const initialView of ["stack", "cover"]) {
      await page.mouse.move(0, 0);
      await page.evaluate(
        (route) => {
          location.hash = `#/${route}`;
          scrollTo(0, 0);
        },
        initialView === "cover" ? `${route}?view=cover` : route,
      );
      await page.reload();
      await expect(
        page.locator(`.album-card--${initialView}`).first(),
      ).toBeVisible();
      await page.waitForTimeout(250);
      await page.waitForFunction(() => {
        return [...document.querySelectorAll(".album-card")].some((card) => {
          const r = card.getBoundingClientRect(),
            image = card.querySelector(".fan-front img");
          return (
            r.bottom > 120 &&
            r.top < innerHeight &&
            image?.getBoundingClientRect().height > 0 &&
            card.querySelector(".fan-front .photo-frame")?.dataset
              .photoState === "ready"
          );
        });
      });
      await page.screenshot({
        path: `verification/view-${route}-stack-installed.png`,
      });
      for (const view of initialView === "stack"
        ? ["cover", "stack"]
        : ["stack", "cover"]) {
        const delayedFirstFrame = initialView === "stack" && view === "cover";
        const recording = page.evaluate(
          ({ view, delayedFirstFrame }) => {
            const card = [...document.querySelectorAll(".album-card")].find(
                (card) => {
                  const r = card.getBoundingClientRect();
                  return (
                    r.top >= 120 &&
                    r.top < innerHeight &&
                    card.querySelector(".fan-front .photo-frame")?.dataset
                      .photoState === "ready"
                  );
                },
              ),
              frame = card.querySelector(".fan-front-layout"),
              image = card.querySelector(".fan-front img");
            const get = () => {
              const b = frame.getBoundingClientRect();
              const p = image.getBoundingClientRect();
              return {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
                imageRatio: p.width / p.height,
              };
            };
            const before = get(),
              frames = [],
              started = performance.now();
            const visible = [...document.querySelectorAll("[data-grid-id]")]
              .filter((node) => {
                const r = node.getBoundingClientRect();
                return (
                  r.bottom > 0 &&
                  r.top < innerHeight &&
                  node.querySelector(".fan-front .photo-frame")?.dataset
                    .photoState === "ready"
                );
              })
              .map((node) => ({
                node,
                image: node.querySelector(".fan-front img"),
              }));
            document
              .querySelector(
                `button[aria-label="${view === "cover" ? "封面视图" : "叠放视图"}"]`,
              )
              .click();
            return new Promise((resolve) => {
              let blocked = false;
              const sample = () => {
                frames.push({
                  ...get(),
                  leafOpacity: Number(
                    getComputedStyle(card.querySelector(".fan-leaf") || card)
                      .opacity,
                  ),
                  time: performance.now() - started,
                  same:
                    image.isConnected &&
                    image === card.querySelector(".fan-front img"),
                  allReady: visible.every(
                    ({ node, image }) =>
                      node.querySelector(".fan-front img") === image &&
                      node.querySelector(".fan-front .photo-frame")?.dataset
                        .photoState === "ready",
                  ),
                });
                if (delayedFirstFrame && !blocked && frame.style.transform) {
                  blocked = true;
                  setTimeout(() => {
                    const until = performance.now() + 300;
                    while (performance.now() < until) {
                      /* cold-frame layout work */
                    }
                  }, 0);
                }
                if (
                  performance.now() - started <
                  (delayedFirstFrame ? 900 : 650)
                )
                  requestAnimationFrame(sample);
                else resolve({ before, frames, visibleCovers: visible.length });
              };
              requestAnimationFrame(sample);
            });
          },
          { view, delayedFirstFrame },
        );
        await page.waitForTimeout(90);
        await page.screenshot({
          path: `verification/view-${route}-to-${view}-mid-installed.png`,
        });
        const result = await recording;
        expect(
          result.frames.every((frame) => frame.same && frame.allReady),
        ).toBe(true);
        const last = result.frames.at(-1);
        expect(
          result.frames.some(
            (frame) =>
              Math.abs(frame.width - result.before.width) > 3 &&
              Math.abs(frame.width - last.width) > 3,
          ),
        ).toBe(true);
        expect(
          Math.max(
            ...result.frames.map((frame) =>
              Math.abs(frame.imageRatio - last.imageRatio),
            ),
          ),
        ).toBeLessThan(0.01);
        if (view === "stack")
          expect(
            result.frames.some(
              (frame) => frame.leafOpacity > 0 && frame.leafOpacity < 0.95,
            ),
          ).toBe(true);
        await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
          "transform",
          "none",
        );
        if (view === "cover")
          expect(
            await page.evaluate(() => {
              const button = [
                ...document.querySelectorAll(".album-overlay button"),
              ].find((button) => {
                const b = button.getBoundingClientRect();
                return b.y > 100 && b.bottom < innerHeight;
              });
              const b = button.getBoundingClientRect();
              return (
                document
                  .elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
                  ?.closest("button") === button
              );
            }),
          ).toBe(true);
        checks.push({
          route,
          initialView,
          view,
          visibleCovers: result.visibleCovers,
          sameImage: true,
          noPlaceholder: true,
          ratioPreserved: true,
          intermediateFrames: true,
          delayedFirstFrame,
          samples: result.frames.length,
        });
        await page.screenshot({
          path: `verification/view-${route}-${view}-installed.png`,
        });
      }
      await page.evaluate(async () => {
        const card = [...document.querySelectorAll(".album-card")].find(
          (card) => {
            const r = card.getBoundingClientRect();
            return r.bottom > 120 && r.top < innerHeight;
          },
        );
        window.__viewCardId = card.closest("[data-grid-id]").dataset.gridId;
        window.__viewImage = card.querySelector(".fan-front img");
        for (const label of ["封面视图", "叠放视图", "封面视图", "叠放视图"]) {
          document.querySelector(`button[aria-label="${label}"]`).click();
          await new Promise((resolve) => setTimeout(resolve, 45));
        }
      });
      await expect(page.locator(".album-card--stack").first()).toBeVisible();
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
      expect(
        await page.evaluate(
          () =>
            window.__viewImage ===
            document.querySelector(
              `[data-grid-id="${window.__viewCardId}"] .fan-front img`,
            ),
        ),
      ).toBe(true);
      await page.evaluate(() => scrollTo(0, 1500));
      await page.waitForTimeout(180);
      const anchor = await page.evaluate(() => {
        const node = [...document.querySelectorAll("[data-grid-id]")].find(
          (node) => node.getBoundingClientRect().bottom > 120,
        );
        window.__anchorImage = node.querySelector(".fan-front img");
        return {
          id: node.dataset.gridId,
          top: node.getBoundingClientRect().top,
        };
      });
      for (const view of ["cover", "stack"]) {
        await page.evaluate(
          (view) =>
            document
              .querySelector(
                `button[aria-label="${view === "cover" ? "封面视图" : "叠放视图"}"]`,
              )
              .click(),
          view,
        );
        await page.waitForTimeout(500);
        const result = await page
          .locator(`[data-grid-id="${anchor.id}"]`)
          .evaluate((node) => ({
            top: node.getBoundingClientRect().top,
            same: node.querySelector(".fan-front img") === window.__anchorImage,
          }));
        expect(result.same).toBe(true);
        // Fractional WebView2/DPI coordinates can differ by a pixel after projection.
        expect(Math.abs(result.top - anchor.top)).toBeLessThanOrEqual(2);
      }
      checks.push({
        route,
        rapidReversal: true,
        scrolledAnchor: true,
        boundedCards: await page.locator("[data-grid-id]").count(),
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() =>
        document.querySelector('button[aria-label="封面视图"]').click(),
      );
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
      await expect(page.locator(".fan-photo-plane").first()).toHaveCSS(
        "transform",
        "none",
      );
      checks.push({ route, reducedMotion: true });
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
  }
  expect(errors).toEqual([]);
} finally {
  await page.emulateMedia({ reducedMotion: null });
  await page.evaluate((original) => {
    location.hash = original.hash;
    delete window.__viewImage;
    delete window.__viewCardId;
    delete window.__anchorImage;
  }, original);
  await page.waitForTimeout(350);
  await page.evaluate((scroll) => scrollTo(0, scroll), original.scroll);
  await browser.close();
  expect(catalogSnapshot(db)).toBe(beforeCatalog);
  db.close();
}
const evidence = { receipt, checks, catalogUnchanged: true, errors };
await writeFile(
  "verification/album-view-transition-installed.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
