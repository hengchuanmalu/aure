import { expect } from "@playwright/test";
import { dirname } from "node:path";

/** The caller seeds copied synthetic media in this isolated desktop catalog. */
export async function checkMediaJourneys(page, invoke, createAuditMedia) {
  expect(await invoke("plugin:app|identifier")).toBe(
    "local.jingji.user-journey-audit",
  );
  const checks = [];
  const openViewer = async (albumId, mediaId) => {
    await page.evaluate(
      ({ albumId, mediaId }) => {
        location.hash = `/viewer/${albumId}/${mediaId}`;
      },
      { albumId, mediaId },
    );
    await expect(page).toHaveURL(new RegExp(`viewer/${albumId}/${mediaId}$`));
    await expect(
      page.getByRole("button", { name: "更多操作", exact: true }),
    ).toBeVisible();
  };
  const openInformation = async () => {
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "媒体信息", exact: true }).click();
    await expect(page.locator(".info-panel")).toBeVisible();
  };
  const readyImage = async () => {
    await expect(page.locator(".media-stage")).toHaveAttribute(
      "data-media-state",
      "ready",
    );
    await expect
      .poll(() =>
        page
          .locator(".media-stage > img")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  };

  const image = await invoke("catalog_entity", { kind: "media", id: "p0" });
  expect(image.src).toBe("http://jingji.localhost/media/p0");
  expect(image.sourceRevision).toBeTruthy();
  const revisionSource = `${image.src}?v=${encodeURIComponent(image.sourceRevision)}`;
  let unavailable = true;
  const temporaryFailure = async (route) => {
    if (unavailable) await route.abort();
    else await route.continue();
  };
  const imagePattern = "http://jingji.localhost/media/p0*";
  await page.route(imagePattern, temporaryFailure);
  try {
    // A reload discards a previously decoded p0 and its cached route snapshot.
    await page.goto("http://tauri.localhost/#/viewer/a0/p0");
    await expect(page.locator(".viewer-error")).toContainText("文件可能缺失");
    await expect(page.locator(".media-stage > img")).toHaveAttribute(
      "src",
      revisionSource,
    );
    unavailable = false;
    await page
      .locator(".viewer-error")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await expect(page.locator(".media-stage > img")).toHaveAttribute(
      "src",
      revisionSource,
    );
    await readyImage();
    await expect(page.locator(".viewer-error")).toHaveCount(0);
    checks.push("native original-image retry keeps its revision and decodes");
  } finally {
    await page.unroute(imagePattern, temporaryFailure);
  }

  await openInformation();
  await expect(
    page.getByRole("button", { name: "重新关联文件", exact: true }),
  ).toBeVisible();
  // The OS picker has separate native acceptance. Only its preview is replaced;
  // cancel remains native and no nonexistent maintenance token is confirmed.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    const audit = { originalFetch, previews: 0, probes: 0 };
    window.__mediaJourneyFetchAudit = audit;
    window.fetch = async (input, options) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        location.href,
      );
      const command = decodeURIComponent(url.pathname.slice(1));
      if (
        url.hostname === "ipc.localhost" &&
        ["prepare_media_relink", "__aure_media_preview_probe__"].includes(
          command,
        )
      ) {
        let args;
        try {
          const body = options?.body;
          const raw =
            typeof body === "string"
              ? body
              : body instanceof ArrayBuffer || ArrayBuffer.isView(body)
                ? new TextDecoder().decode(body)
                : input instanceof Request
                  ? await input.clone().text()
                  : "";
          args = JSON.parse(raw);
        } catch {
          // Returning an IPC error avoids Tauri falling back to its real picker.
          return new Response(JSON.stringify("验收请求参数无法读取"), {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "error",
            },
          });
        }
        if (args?.id === "p0") {
          if (command === "__aure_media_preview_probe__") {
            audit.probes++;
            return new Response(
              JSON.stringify({ nativeMediaFetchProbe: true }),
              {
                headers: {
                  "Content-Type": "application/json",
                  "Tauri-Response": "ok",
                },
              },
            );
          }
          audit.previews++;
          return new Response(
            JSON.stringify({
              token: "user-journey-only-preview",
              name: "replacement.jpg",
              previousName: "photo.jpg",
              path: "synthetic/replacement.jpg",
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "ok",
              },
            },
          );
        }
      }
      return originalFetch.call(window, input, options);
    };
  });
  try {
    // An unsupported probe command has no native effect if IPC bypasses fetch.
    // Verify transport before any command that could open the system picker.
    expect(await invoke("__aure_media_preview_probe__", { id: "p0" })).toEqual({
      nativeMediaFetchProbe: true,
    });
    expect(
      await page.evaluate(() => window.__mediaJourneyFetchAudit.probes),
    ).toBe(1);
    await page
      .getByRole("button", { name: "重新关联文件", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "重新关联媒体文件？",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() => window.__mediaJourneyFetchAudit.previews),
    ).toBe(1);
    await page.evaluate(() => {
      window.fetch = window.__mediaJourneyFetchAudit.originalFetch;
      delete window.__mediaJourneyFetchAudit;
    });
    for (const key of ["ArrowRight", "ArrowLeft", "i", "f", "1"]) {
      await page.keyboard.press(key);
      await expect(page).toHaveURL(/viewer\/a0\/p0$/);
      await expect(dialog).toBeVisible();
      await expect(page.locator(".info-panel")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".info-panel")).toBeVisible();
    await page.getByRole("button", { name: "关闭信息", exact: true }).click();
    await page.getByRole("button", { name: "下一项", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/viewer\/a0\/p1$/);
    await readyImage();
    checks.push(
      "relink dialog owns its keys; Escape and viewer navigation recover",
    );
  } finally {
    await page.evaluate(() => {
      if (window.__mediaJourneyFetchAudit) {
        window.fetch = window.__mediaJourneyFetchAudit.originalFetch;
        delete window.__mediaJourneyFetchAudit;
      }
    });
  }

  await openViewer("broken-album", "broken");
  await expect(page.locator(".viewer-error")).toContainText("文件可能缺失");
  await page
    .locator(".viewer-error")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(page.locator(".viewer-error")).toContainText("文件可能缺失");
  await page
    .locator(".viewer-error")
    .getByRole("button", { name: "返回详情", exact: true })
    .click();
  await expect(page).toHaveURL(/album\/broken-album$/);
  await expect(
    page.getByRole("heading", { name: "损坏文件回归", exact: true }),
  ).toBeVisible();
  checks.push(
    "a real corrupt registered image reports failure and permits retry/return",
  );

  await openViewer("a0", "v0");
  const video = page.locator(".media-stage > video");
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 60000,
    })
    .toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((element) => element.videoWidth)).toBeGreaterThan(
    0,
  );
  const duration = await video.evaluate((element) => element.duration);
  expect(Number.isFinite(duration) && duration > 0).toBe(true);
  await video.evaluate((element) => element.pause());
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => video.evaluate((element) => element.currentTime))
    .toBeGreaterThan(0.15);
  await video.evaluate((element) => element.pause());
  const seek = Math.min(duration * 0.4, 2);
  await page
    .getByRole("slider", { name: "播放进度", exact: true })
    .fill(String(seek));
  await expect
    .poll(() => video.evaluate((element) => element.currentTime))
    .toBeCloseTo(seek, 1);

  await openInformation();
  const tag = page
    .locator(".info-panel")
    .getByRole("button", { name: "清新", exact: true });
  const selected = await tag.getAttribute("aria-pressed");
  await tag.focus();
  await page.keyboard.press("Space");
  await expect(tag).toHaveAttribute(
    "aria-pressed",
    selected === "true" ? "false" : "true",
  );
  expect(await video.evaluate((element) => element.paused)).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/viewer\/a0\/v0$/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".info-panel")).toHaveCount(0);
  const oldVideo = await video.elementHandle();
  await page.getByRole("button", { name: "下一项", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page).toHaveURL(/viewer\/a0\/v1$/);
  await expect(
    page.locator('.viewer-thumbnail[aria-current="true"]'),
  ).toHaveAttribute("data-media-id", "v1");
  await expect
    .poll(() => video.evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(
    await oldVideo.evaluate(
      (element) => element.paused && !element.getAttribute("src"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "上一项", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).toHaveURL(/viewer\/a0\/v0$/);
  await expect(
    page.locator('.viewer-thumbnail[aria-current="true"]'),
  ).toHaveAttribute("data-media-id", "v0");
  await expect
    .poll(() => video.evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "返回详情", exact: true }).click();
  await expect(page.locator(".viewer")).toHaveCount(0);
  expect(
    await page
      .locator("video")
      .evaluateAll((elements) => elements.every((element) => element.paused)),
  ).toBe(true);
  checks.push(
    "real video decoding, playback, seek, keyboard tag edits and switch cleanup",
  );
  await checkContinuousTouch(page, invoke, createAuditMedia);
  checks.push(
    "continuous native touch can reverse during docking and continue forward without changing alignment",
  );
  return checks;
}

async function checkContinuousTouch(page, invoke, createAuditMedia) {
  expect(await invoke("plugin:app|identifier")).toBe(
    "local.jingji.user-journey-audit",
  );
  const settings = (
    await invoke("catalog_view", { query: { route: "settings" } })
  ).db.settings;
  const systemReduced = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  try {
    await invoke("catalog_patch", {
      changes: { settings: { ...settings, reducedMotion: false } },
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await checkContinuousTouchWithMotion(page, invoke, createAuditMedia);
  } finally {
    await invoke("catalog_patch", { changes: { settings } });
    await page.emulateMedia({
      reducedMotion: systemReduced ? "reduce" : "no-preference",
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("jingji:catalog-changed")),
    );
  }
}

async function checkContinuousTouchWithMotion(page, invoke, createAuditMedia) {
  const template = await invoke("catalog_entity", { kind: "albums", id: "a0" });
  const image = await invoke("catalog_entity", { kind: "media", id: "p0" });
  delete template._summary;
  delete template.sourceDirectory;
  const media = await createAuditMedia(image, "journey-touch", 80);
  const album = {
    ...template,
    id: "journey-touch",
    name: "触屏手势审计",
    mediaIds: media.map((item) => item.id),
    cover: media[0].src,
    coverMediaId: media[0].id,
    sourceDirectory: dirname(image.sourcePath),
    favorite: false,
  };
  await invoke("catalog_operation", {
    op: {
      type: "importPrepared",
      album,
      media,
      models: [],
      groups: [],
      tags: [],
      importRules: [],
    },
  });
  await page.evaluate(() => {
    location.hash = "/album/journey-touch";
  });
  await expect(
    page.getByRole("heading", { name: "触屏手势审计", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".media-layout")).toHaveAttribute(
    "data-total-items",
    "80",
  );
  const browse = page.locator(".album-browse");
  await expect(browse).toHaveAttribute("data-docked", "false");
  await expect(page.locator(".album-hero-cover")).toHaveAttribute(
    "data-photo-state",
    "ready",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  const geometry = await page.evaluate(() => {
    const origin = document
      .querySelector(".album-browse-origin")
      .getBoundingClientRect();
    const edit = document
      .querySelector(".topbar-action-group > button")
      .getBoundingClientRect();
    const header = document.querySelector(".topbar").getBoundingClientRect();
    return {
      x: Math.min(innerWidth - 80, innerWidth * 0.7),
      startY: innerHeight - 60,
      contact: origin.top + scrollY - (edit.bottom - header.top + 6),
      previousTouchPoints: navigator.maxTouchPoints,
    };
  });
  const session = await page.context().newCDPSession(page);
  const touch = async (type, y) => {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [{ x: geometry.x, y, radiusX: 1, radiusY: 1, id: 1 }],
    });
  };
  try {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await touch("touchStart", geometry.startY);
    let contactFinger = geometry.startY;
    for (const desired of [
      35,
      235,
      geometry.contact - 35,
      geometry.contact - 15,
      geometry.contact - 7,
      geometry.contact - 3,
      geometry.contact + 1,
      geometry.contact + 5,
    ]) {
      contactFinger = Math.max(90, geometry.startY - desired - 15);
      await touch("touchMove", contactFinger);
      await page.waitForTimeout(12);
      if ((await browse.getAttribute("data-docked")) === "true") break;
    }
    await expect(browse).toHaveAttribute("data-docked", "true");
    const contactScroll = await page.evaluate(() => scrollY);
    const reverseFinger = Math.min(geometry.startY, contactFinger + 240);
    await touch("touchMove", reverseFinger);
    await expect(browse).toHaveAttribute("data-docked", "false");
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeLessThan(contactScroll - 100);
    const reversed = await page.evaluate(() => scrollY);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(reversed);
    await touch("touchEnd", reverseFinger);

    const startScroll = await page.evaluate(() => scrollY);
    await touch("touchStart", geometry.startY);
    for (const distance of [50, 250, 450, 650]) {
      await touch("touchMove", Math.max(90, geometry.startY - distance));
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(300);
    await touch("touchEnd", 90);
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(startScroll + 300);
    await expect(browse).toHaveAttribute("data-docked", "true");
    await expect
      .poll(() =>
        browse.evaluate((element) => {
          const current = element.getBoundingClientRect();
          const target = document
            .querySelector(".album-browse-target")
            .getBoundingClientRect();
          return (
            Math.abs(current.left - target.left) +
            Math.abs(current.top - target.top)
          );
        }),
      )
      .toBeLessThan(1);
  } finally {
    await touch("touchEnd", 0).catch(() => {});
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: geometry.previousTouchPoints > 0,
      ...(geometry.previousTouchPoints > 0
        ? { maxTouchPoints: Math.min(16, geometry.previousTouchPoints) }
        : {}),
    });
    await session.detach();
  }
}
