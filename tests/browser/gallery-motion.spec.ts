import { expect, test } from "../support/browser.fixture";

for (const route of ["library", "tags"]) {
  test(`${route} cover cards keep title and count together with restrained hover feedback`, async ({
    page,
  }) => {
    await page.goto(`/#/${route}?view=cover`);
    const cards = page.locator(".cover-grid .album-card--cover");
    const card = cards.first();
    const neighbor = cards.nth(1);
    const textGap = () =>
      card.evaluate(
        (el) =>
          el.querySelector(".card-bottom")!.getBoundingClientRect().top -
          el.querySelector("h3")!.getBoundingClientRect().bottom,
      );
    await expect(card).toBeVisible();
    expect(await textGap()).toBeLessThanOrEqual(2);
    const before = await neighbor.boundingBox();
    const shadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    await card.hover();
    await expect(card).toHaveCSS(
      "transform",
      "matrix(1.015, 0, 0, 1.015, 0, 0)",
    );
    await expect(card).not.toHaveCSS("box-shadow", shadow);
    expect(
      await card
        .locator(".album-overlay button")
        .last()
        .evaluate((button) => {
          const box = button.getBoundingClientRect();
          return (
            document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.closest("button") === button
          );
        }),
    ).toBe(true);
    await expect(card.locator(".fan-front img")).toHaveCSS("transform", "none");
    expect(await textGap()).toBeLessThanOrEqual(2);
    const after = await neighbor.boundingBox();
    for (const key of ["x", "y", "width", "height"] as const)
      expect(after![key]).toBeCloseTo(before![key], 1);
    await page.mouse.move(0, 0);
    await expect(card).toHaveCSS("transform", "none");
    await card.locator(".cover-link").focus();
    await expect(card).toHaveCSS(
      "transform",
      "matrix(1.015, 0, 0, 1.015, 0, 0)",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(card).toHaveCSS("transform", "none");
  });
}

test("album fans use real album media and expand without moving neighboring cards", async ({
  page,
}) => {
  await page.goto("/#/album/a0");
  await page.waitForFunction(
    () => localStorage.getItem("jingji.mock.v1") !== null,
  );
  await page.goto("/#/library");
  const card = page.locator(".album-grid .album-card").first();
  const front = card.locator(".fan-front");
  await expect(card).toHaveCSS("opacity", "1");
  await expect(front).toHaveCSS("transform", "none");
  const sources = await card
    .locator(".fan-leaf img")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  const expected = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    const album = db.albums.find((a: { id: string }) => a.id === "a0");
    return album.mediaIds
      .map((id: string) => db.media.find((m: { id: string }) => m.id === id))
      .map((m: { kind: string; src: string; poster?: string }) =>
        m.kind === "image" ? m.src : m.poster,
      )
      .filter(Boolean);
  });
  expect(sources.length).toBeGreaterThan(0);
  for (const source of sources) expect(expected).toContain(source);
  const neighbor = page.locator(".album-grid .album-card").nth(1);
  await expect(page.locator(".page-content > div")).toHaveCSS(
    "transform",
    "none",
  );
  await expect(neighbor).toHaveCSS("transform", "none");
  const before = await neighbor.boundingBox();
  await card.hover();
  await expect(front).toHaveCSS(
    "transform",
    "matrix(1.025, 0, 0, 1.025, 0, -7)",
  );
  const after = await neighbor.boundingBox();
  for (const key of ["x", "y", "width", "height"] as const)
    expect(after![key]).toBeCloseTo(before![key], 1);
  await page.screenshot({ path: "verification/motion-fan-hover.png" });
  await page.mouse.move(0, 0);
  await expect(front).toHaveCSS("transform", "none");
  await card.getByRole("link").focus();
  await expect(front).not.toHaveCSS("transform", "none");
});

test("view choice survives filtering and reload; category strip stays in reach", async ({
  page,
}) => {
  await page.goto("/#/library");
  await page.getByRole("button", { name: "封面视图", exact: true }).click();
  await expect(page.locator(".album-grid .album-card--cover")).toHaveCount(12);
  await page
    .getByRole("group", { name: "按模特快速筛选" })
    .getByRole("button", { name: /^林夏/ })
    .click();
  await expect(page.locator(".album-grid .album-card--cover")).toHaveCount(2);
  await expect(page.locator(".collection-context")).toContainText("林夏");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "封面视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^全部模特/ }).click();
  await page.mouse.wheel(0, 550);
  const filters = page.getByRole("group", { name: "按模特快速筛选" });
  await expect
    .poll(async () => (await filters.boundingBox())!.y)
    .toBeGreaterThanOrEqual(57);
  await expect(filters).toBeInViewport();
  await filters.getByRole("button", { name: /^许知遥/ }).click();
  await expect(page.locator(".album-grid .album-card--cover")).toHaveCount(2);
  await page.getByRole("button", { name: "叠放视图", exact: true }).click();
  await expect(page.locator(".album-grid .album-card--stack")).toHaveCount(2);
});

for (const preference of ["system", "app"] as const) {
  test(`${preference} reduced motion keeps fan geometry static`, async ({
    page,
  }) => {
    if (preference === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    if (preference === "app") {
      await page.goto("/#/settings");
      await page
        .getByRole("navigation", { name: "设置分类" })
        .getByRole("button", { name: "高级设置" })
        .click();
      await page.getByRole("switch", { name: "减少动态效果" }).check();
    }
    await page.goto("/#/library");
    const card = page.locator(".album-grid .album-card").first();
    const leaf = card.locator(".leaf-0");
    const before = await leaf.evaluate((el) => getComputedStyle(el).transform);
    await card.hover();
    await expect(card.locator(".fan-front")).toHaveCSS("transform", "none");
    await expect(leaf).toHaveCSS("transform", before);
    await expect(leaf).toHaveCSS("transition-duration", "0s");
    await expect(card).toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "封面视图", exact: true }).click();
    const cover = page.locator(".cover-grid .album-card--cover").first();
    await cover.hover();
    await expect(cover).toHaveCSS("transform", "none");
    await expect(cover).toHaveCSS("transition-duration", "0s");
    await expect(cover.locator(".fan-front-layout")).toHaveCSS(
      "transform",
      "none",
    );
    await expect(cover.locator(".fan-photo-plane")).toHaveCSS(
      "transform",
      "none",
    );
  });
}
