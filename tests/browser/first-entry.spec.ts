import { expect, test } from "@playwright/test";
import { seedFixture } from "../support/demo.fixture";

// Delayed native snapshots exercise the first render before route data arrives.
async function delayedDesktop(
  page: import("@playwright/test").Page,
  cachedMedia = false,
) {
  await page.addInitScript(
    ({ fixture, cachedMedia }) => {
      const calls: { command: string; args: any }[] = [];
      (window as any).__firstEntryCalls = calls;
      const recent: any[] = [];
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any = {}) => {
          calls.push({ command, args });
          if (command === "catalog_initialize") return false;
          if (command === "catalog_recent") {
            if (args.entry) recent.splice(0, recent.length, args.entry);
            return structuredClone(recent);
          }
          if (command === "plugin:window|is_fullscreen") return false;
          if (command === "plugin:window|set_fullscreen") return;
          if (command === "catalog_candidates")
            return { items: fixture.media, total: fixture.media.length };
          if (command === "catalog_entity")
            return (window as any).__firstEntryMissingModel
              ? null
              : fixture.models.find((model) => model.id === args.id);
          if (command === "catalog_model_albums") return [fixture.albums[0].id];
          if (command === "catalog_view") {
            const query = args.query;
            if (query.route !== "settings")
              await new Promise((resolve) => setTimeout(resolve, 350));
            const album =
              fixture.albums.find(
                (a) => a.id === query.owner || a.id === query.id,
              ) || fixture.albums[0];
            const db = {
              ...fixture,
              albums: query.route === "settings" ? [] : [album],
              models: query.route === "settings" ? [] : fixture.models,
              media:
                query.route === "settings" && !cachedMedia ? [] : fixture.media,
              recent: structuredClone(recent),
            };
            return {
              db,
              page: 0,
              limit: 96,
              total: album.mediaIds.length,
              albumTotal: fixture.albums.length,
              modelTotal: fixture.models.length,
              mediaTotal: fixture.media.length,
              mediaCount: fixture.media.length,
              visibleMediaIds: album.mediaIds,
              viewer:
                query.route === "viewer"
                  ? {
                      index: 0,
                      total: album.mediaIds.length,
                      next: album.mediaIds[1],
                    }
                  : undefined,
            };
          }
          throw Error(`Unexpected native call: ${command}`);
        },
      };
    },
    { fixture: seedFixture(), cachedMedia },
  );
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
}

test("first album entry records recent browsing after its native snapshot arrives", async ({
  page,
}) => {
  await delayedDesktop(page);
  await page.evaluate(() => (location.hash = "/album/a0"));
  await expect(page.locator(".album-hero")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__firstEntryCalls.filter(
            (call: any) =>
              call.command === "catalog_recent" &&
              call.args.entry?.albumId === "a0",
          ).length,
      ),
    )
    .toBe(1);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      () =>
        (window as any).__firstEntryCalls.filter(
          (call: any) => call.command === "catalog_recent",
        ).length,
    ),
  ).toBe(1);
});

for (const [route, status, error, surface] of [
  ["/album/a0", "正在读取写真集…", "写真集不存在", ".album-hero"],
  ["/models/m0", "正在读取模特资料…", "模特不存在", ".model-hero"],
  ["/viewer/a0/p0", "正在读取媒体…", "媒体不存在", ".viewer"],
])
  test(`first delayed entry to ${route} shows loading until valid data arrives`, async ({
    page,
  }) => {
    await delayedDesktop(page);
    await page.evaluate((route) => (location.hash = route), route);
    const loading = route.startsWith('/viewer/') ? /正在(?:读取媒体|加载)…/ : status;
    await expect(
      page.getByRole("status").filter({ hasText: loading }),
    ).toBeVisible();
    await expect(page.getByText(error, { exact: true })).toHaveCount(0);
    await expect(page.locator(surface)).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: loading }),
    ).toHaveCount(0);
  });

test("first cached image entry initializes actual-size zoom before the first keyboard action", async ({
  page,
}) => {
  await delayedDesktop(page);
  await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    location.hash = "/viewer/a0/p0";
  }, seedFixture().media[0].src);
  await expect(page.locator(".media-stage")).toHaveAttribute(
    "data-media-state",
    "ready",
  );
  await page.keyboard.press("1");
  await expect
    .poll(() =>
      page.locator(".media-stage > img").evaluate((image: HTMLImageElement) => {
        const fit = Math.min(
          image.clientWidth / image.naturalWidth,
          image.clientHeight / image.naturalHeight,
        );
        const zoom = new DOMMatrix(getComputedStyle(image).transform).a;
        // The element includes letterboxing; compare the rendered bitmap scale.
        return Math.abs(fit * zoom - 1) < 0.001;
      }),
    )
    .toBe(true);
});

test("first direct viewer entry establishes focus after its media arrives", async ({
  page,
}) => {
  await delayedDesktop(page);
  await page.evaluate(() => (location.hash = "/viewer/a0/p0"));
  await expect(page.locator(".viewer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回详情", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".viewer")),
  ).toBe(true);
});

test("first viewer entry with cached media records a visit when its uncached album arrives", async ({
  page,
}) => {
  await delayedDesktop(page, true);
  await page.evaluate(() => (location.hash = "/viewer/a0/p0"));
  await expect(page.locator(".viewer-heading strong")).toHaveText(
    seedFixture().albums[0].name,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__firstEntryCalls.filter(
            (call: any) =>
              call.command === "catalog_recent" &&
              call.args.entry?.mediaId === "p0",
          ).length,
      ),
    )
    .toBe(1);
});

test("first missing model read keeps the editor in recovery and retry never creates a blank profile", async ({
  page,
}) => {
  await delayedDesktop(page);
  await page.evaluate(() => {
    location.hash = "/models/m0";
    (window as any).__firstEntryMissingModel = true;
  });
  await expect(page.locator(".model-hero")).toBeVisible();
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("资料已不存在");
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveCount(0);
  await page.evaluate(() => ((window as any).__firstEntryMissingModel = false));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    seedFixture().models[0].name,
  );
});
