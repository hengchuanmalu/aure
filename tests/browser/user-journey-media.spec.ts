import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

async function relinkFixture(page: Page) {
  const db = seedFixture();
  db.settings.reducedMotion = true;
  db.media[0].sourcePath = "D:/fixtures/photo.jpg";
  await page.addInitScript((full) => {
    const calls: string[] = [];
    (window as any).__mediaJourneyCalls = calls;
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      invoke: async (command: string, args: any = {}) => {
        calls.push(command);
        if (command === "catalog_initialize") return false;
        if (command === "catalog_recent") return [];
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:window|set_fullscreen") return;
        if (command === "catalog_candidates")
          return { items: full.media, total: full.media.length };
        if (command === "read_media_metadata")
          return { width: 1600, height: 1067, exif: {} };
        if (command === "prepare_media_relink")
          return {
            token: "link-preview",
            name: "replacement.jpg",
            previousName: "photo.jpg",
            path: "D:/fixtures/replacement.jpg",
          };
        if (command === "cancel_catalog_maintenance") return;
        if (command === "catalog_view") {
          const album = full.albums[0];
          const index = album.mediaIds.indexOf(args.query.id);
          return {
            db: full,
            page: 0,
            limit: 96,
            total: album.mediaIds.length,
            albumTotal: full.albums.length,
            modelTotal: full.models.length,
            mediaTotal: full.media.length,
            mediaCount: full.media.length,
            visibleMediaIds: album.mediaIds,
            viewer: {
              index,
              total: album.mediaIds.length,
              previous: album.mediaIds[index - 1],
              next: album.mediaIds[index + 1],
            },
          };
        }
        throw Error(`Unexpected native call: ${command}`);
      },
    };
  }, db);
  await page.goto("/#/viewer/a0/p0");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "媒体信息", exact: true }).click();
}

test("retrying a temporarily unavailable relinked image keeps its source revision", async ({
  page,
}) => {
  const db = seedFixture();
  db.media[0].src = "http://jingji.localhost/media/p0";
  db.media[0].sourceRevision = "updated-revision";
  await page.addInitScript(
    (full) => localStorage.setItem("jingji.mock.v1", JSON.stringify(full)),
    db,
  );
  const photo = await readFile("tests/fixtures/media/p-1239291.jpg");
  let available = false;
  const recoveredRequests: string[] = [];
  await page.route("http://jingji.localhost/media/p0*", async (route) => {
    if (!available) await route.abort();
    else {
      recoveredRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: photo,
      });
    }
  });
  await page.goto("/#/viewer/a0/p0");
  await expect(page.locator(".viewer-error")).toContainText("文件可能缺失");
  available = true;
  await page
    .locator(".viewer-error")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(page.locator(".media-stage > img")).toHaveAttribute(
    "src",
    "http://jingji.localhost/media/p0?v=updated-revision",
  );
  await expect(page.locator(".media-stage")).toHaveAttribute(
    "data-media-state",
    "ready",
  );
  expect(recoveredRequests).toContain(
    "http://jingji.localhost/media/p0?v=updated-revision",
  );
  await expect(page.locator(".viewer-error")).toHaveCount(0);
});

test("relink confirmation owns navigation keys and Escape leaves the media information open", async ({
  page,
}) => {
  await relinkFixture(page);
  await page.getByRole("button", { name: "重新关联文件", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "重新关联媒体文件？",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  for (const key of ["ArrowRight", "ArrowLeft", "i", "f", "1"]) {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/viewer\/a0\/p0$/);
    await expect(dialog).toBeVisible();
    await expect(page.locator(".info-panel")).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".info-panel")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__mediaJourneyCalls.filter(
            (command: string) => command === "cancel_catalog_maintenance",
          ).length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "关闭信息", exact: true }).click();
  await page.getByRole("button", { name: "下一项", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/viewer\/a0\/p1$/);
});

test("keyboard tag editing in video information does not start playback or change media", async ({
  page,
}) => {
  await page.goto("/#/viewer/a0/v0");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "媒体信息", exact: true }).click();
  const video = page.locator(".media-stage > video");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  const tag = page
    .locator(".info-panel")
    .getByRole("button", { name: "清新", exact: true });
  await expect(tag).toHaveAttribute("aria-pressed", "false");
  await tag.focus();
  await page.keyboard.press("Space");
  await expect(tag).toHaveAttribute("aria-pressed", "true");
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/viewer\/a0\/v0$/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".info-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "下一项", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page).toHaveURL(/viewer\/a0\/v1$/);
});
