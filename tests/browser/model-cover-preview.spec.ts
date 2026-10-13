import { expect, test } from "../support/browser.fixture";

const modelLink = (id: string) =>
  `.models-grid .model-card[href="#/models/${id}"]`;

test("avatar expands three right-aligned covers, reflows siblings and links to the album", async ({
  page,
}) => {
  await page.goto("/#/models");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    db.albums.forEach((album: { modelIds: string[] }, i: number) => {
      album.modelIds = i < 8 ? ["m0"] : ["m1"];
    });
    localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
  });
  await page.reload();
  const card = page.locator(modelLink("m0"));
  const avatar = card.locator(".model-cover-preview-trigger");
  const preview = page.locator(".model-cover-preview");
  await expect(card).toBeVisible();
  const original = await page.evaluate(() =>
    localStorage.getItem("jingji.mock.v1"),
  );
  const before = await page
    .locator(".models-grid > [data-grid-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
  await card.locator("strong").hover();
  await page.waitForTimeout(250);
  await expect(preview).toHaveCount(0);
  await avatar.hover();
  await expect(preview.locator("img")).toHaveCount(3);
  await expect(preview.locator('[data-photo-state="ready"]')).toHaveCount(3);
  await page.waitForTimeout(350);
  const names = await preview
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("alt")));
  expect(new Set(names).size).toBe(3);
  const allowed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jingji.mock.v1")!)
      .albums.filter((album: { modelIds: string[] }) =>
        album.modelIds.includes("m0"),
      )
      .map((album: { name: string }) => album.name),
  );
  names.forEach((name) => expect(allowed).toContain(name));
  const cover = (await preview.locator("a").first().boundingBox())!;
  const avatarBox = (await avatar.boundingBox())!;
  expect(cover.x).toBeGreaterThan(avatarBox.x + avatarBox.width);
  expect(Math.abs(cover.y - avatarBox.y)).toBeLessThan(2);
  const after = await page
    .locator(".models-grid > [data-grid-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
  expect(
    after.some((box, i) => box.x !== before[i].x || box.y !== before[i].y),
  ).toBe(true);
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2, {
    steps: 12,
  });
  await page.waitForTimeout(400);
  expect(
    await preview
      .locator("img")
      .evaluateAll((images) =>
        images.map((image) => image.getAttribute("alt")),
      ),
  ).toEqual(names);
  expect(
    await page.evaluate(() => localStorage.getItem("jingji.mock.v1")),
  ).toBe(original);
  await page.screenshot({
    path: "verification/model-cover-preview/browser.png",
  });
  const href = await preview.locator("a").first().getAttribute("href");
  await preview.locator("a").first().click();
  expect(new URL(page.url()).hash).toBe(href);
  await page.getByRole("button", { name: "返回模特", exact: true }).click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(preview).toHaveCount(0);
  await page.locator(modelLink("m0")).click();
  await expect(page).toHaveURL(/\/models\/m0$/);
});

test("last column wraps, later avatars fill the gap, and covers stay reachable", async ({
  page,
}) => {
  await page.goto("/#/models");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    db.models.push(
      ...Array.from({ length: 6 }, (_, i) => ({
        ...db.models[0],
        id: `extra-${i}`,
        name: `Z${i}`,
      })),
    );
    db.albums.forEach((album: { modelIds: string[] }) => {
      album.modelIds = db.models.map((m: { id: string }) => m.id);
    });
    localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
  });
  await page.reload();
  const columns = await page
    .locator(".models-grid")
    .evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
    );
  const order = await page
    .locator(".models-grid > [data-grid-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-grid-id")!),
    );
  const target = page
    .locator(".models-grid .model-cover-preview-trigger")
    .nth(columns - 1);
  const targetId = await target.evaluate((node) =>
    node
      .closest("[data-model-preview-id]")!
      .getAttribute("data-model-preview-id"),
  );
  const avatar = page.locator(
    `[data-model-preview-id="${targetId}"] .model-cover-preview-trigger`,
  );
  const before = (await avatar.boundingBox())!;
  await avatar.hover();
  const preview = page.locator(".model-cover-preview");
  await expect(preview.locator("a")).toHaveCount(3);
  await page.waitForTimeout(600);
  await expect(preview).toBeVisible();
  const after = (await avatar.boundingBox())!;
  expect(after.y).toBeGreaterThan(before.y + before.height);
  const filled = (await page
    .locator(`[data-grid-id="${order[columns]}"] .model-cover-preview-trigger`)
    .boundingBox())!;
  expect(Math.abs(filled.x - before.x)).toBeLessThan(2);
  expect(Math.abs(filled.y - before.y)).toBeLessThan(2);
  const link = preview.locator("a").last();
  const r = (await link.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 16 });
  await page.waitForTimeout(350);
  await expect(preview.locator("a")).toHaveCount(3);
  const groups = await page
    .locator(".models-grid > [data-grid-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i],
        b = groups[j];
      expect(
        a.right <= b.x + 1 ||
          b.right <= a.x + 1 ||
          a.bottom <= b.y + 1 ||
          b.bottom <= a.y + 1,
      ).toBe(true);
    }
  await page.mouse.move(10, 900);
  await expect(preview).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(
    await page
      .locator(".models-grid > [data-grid-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-grid-id")!),
      ),
  ).toEqual(order);
});

test("single and empty models, narrow width and keyboard access", async ({
  page,
}) => {
  await page.goto("/#/models");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    db.albums.forEach((album: { modelIds: string[] }, i: number) => {
      album.modelIds = i === 0 ? ["m0"] : ["m1"];
    });
    localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
  });
  await page.reload();
  const trigger = (id: string) =>
    page.locator(modelLink(id)).locator(".model-cover-preview-trigger");
  const preview = page.locator(".model-cover-preview");
  await trigger("m2").hover();
  await page.waitForTimeout(250);
  await expect(preview).toHaveCount(0);
  await trigger("m0").hover();
  await expect(preview.locator("a")).toHaveCount(1);
  await page.mouse.move(10, 900);
  await expect(preview).toHaveCount(0);
  await page.setViewportSize({ width: 520, height: 800 });
  await trigger("m1").hover();
  await expect(preview.locator("a")).toHaveCount(3);
  await page.waitForTimeout(300);
  const bounds = (await preview.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(520);
  await page.mouse.move(10, 780);
  await expect(preview).toHaveCount(0);
  await page.keyboard.press("Tab");
  await page.locator(modelLink("m0")).focus();
  await expect(preview.locator("a")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(preview.locator("a")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.locator(modelLink("m0"))).toBeFocused();
});

for (const reduced of [false, true])
  test(`large model list stays virtualized across expansion (${reduced ? "reduced" : "full"} motion)`, async ({
    page,
  }) => {
    await page.goto("/#/models");
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
      const template = db.models[0];
      db.models = Array.from({ length: 800 }, (_, i) => ({
        ...template,
        id: `large-${i}`,
        name: `Model ${String(i).padStart(4, "0")}`,
      }));
      db.albums.forEach((album: { modelIds: string[] }) => {
        album.modelIds = db.models.map((m: { id: string }) => m.id);
      });
      localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
    });
    await page.reload();
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await expect(page.locator(".models-grid")).toHaveAttribute(
      "data-total-items",
      "800",
    );
    expect(
      await page.locator(".models-grid > [data-grid-id]").count(),
    ).toBeLessThan(90);
    await page.evaluate(() => window.scrollTo(0, 2300));
    await page.waitForTimeout(250);
    const avatarIndex = await page
      .locator(".models-grid .model-cover-preview-trigger")
      .evaluateAll((nodes) =>
        nodes.findIndex((node) => {
          const r = node.getBoundingClientRect();
          return r.top > 140 && r.bottom < innerHeight;
        }),
      );
    const avatar = page
      .locator(".models-grid .model-cover-preview-trigger")
      .nth(avatarIndex);
    await avatar.hover();
    await expect(page.locator(".model-cover-preview a")).toHaveCount(3);
    await page.waitForTimeout(400);
    expect(
      await page.locator(".models-grid > [data-grid-id]").count(),
    ).toBeLessThan(100);
    await expect(page.locator(".model-cover-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".model-cover-preview")).toHaveCount(0);
    await page.waitForTimeout(350);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(page.locator(modelLink("large-799"))).toBeVisible();
  });

test("quickly switching avatars settles on the last hovered model", async ({
  page,
}) => {
  await page.goto("/#/models");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    db.albums.forEach((album: { modelIds: string[] }) => {
      album.modelIds = db.models.map((model: { id: string }) => model.id);
    });
    localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
  });
  await page.reload();
  const avatars = page.locator(".models-grid .model-cover-preview-trigger");
  await avatars.nth(0).hover();
  await expect(page.locator(".model-cover-preview a")).toHaveCount(3);
  const targetId = await avatars
    .nth(1)
    .evaluate((node) =>
      node
        .closest("[data-model-preview-id]")!
        .getAttribute("data-model-preview-id"),
    );
  await avatars.nth(1).hover();
  await expect(
    page.locator('.model-preview-group[data-expanded="true"]'),
  ).toHaveAttribute("data-model-preview-id", targetId!);
  await expect(page.locator(".model-cover-preview a")).toHaveCount(3);
  await page.waitForTimeout(350);
  await expect(
    page.locator('.model-preview-group[data-expanded="true"]'),
  ).toHaveAttribute("data-model-preview-id", targetId!);
  await page.mouse.wheel(0, 60);
  await expect(page.locator(".model-cover-preview")).toHaveCount(0);
});
