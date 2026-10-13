import { expect, test } from "../support/browser.fixture";

test("model view survives reload and returning from an album", async ({
  page,
}) => {
  await page.goto("/#/models/m0?sort=name");
  const section = page.getByRole("region", { name: "关联写真集", exact: true });
  await expect(section.locator(".album-card--stack")).toHaveCount(2);
  await section.getByRole("button", { name: "封面视图", exact: true }).click();
  await expect(page).toHaveURL(/models\/m0\?sort=name&view=cover$/);
  await expect(section.locator(".album-card--cover")).toHaveCount(2);
  await page.reload();
  await expect(
    section.getByRole("button", { name: "封面视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await section.locator(".cover-link").first().click();
  await page.getByRole("button", { name: "返回模特", exact: true }).click();
  await expect(page).toHaveURL(/models\/m0\?sort=name&view=cover$/);
  await expect(section.locator(".album-card--cover")).toHaveCount(2);
  const stack = section.getByRole("button", { name: "叠放视图", exact: true });
  await stack.focus();
  await stack.press("Enter");
  await expect(stack).toBeFocused();
  await expect(stack).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/models\/m0\?sort=name$/);
  await expect(section.locator(".album-card--stack")).toHaveCount(2);
});

test("model view changes preserve the browsing position and continuous loading window", async ({
  page,
}) => {
  await page.goto("/#/models/m0");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
    const albums = db.albums;
    db.albums = Array.from({ length: 240 }, (_, index) => ({
      ...albums[index % albums.length],
      id: `model-album-${index}`,
      name: `写真 ${index}`,
      modelIds: ["m0"],
    }));
    localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "关联写真集 · 240" }),
  ).toBeVisible();
  await page.evaluate(() => scrollTo(0, 1700));
  await page.waitForTimeout(150);
  const anchor = await page.evaluate(() => {
    const node = [
      ...document.querySelectorAll<HTMLElement>("[data-grid-id]"),
    ].find((node) => node.getBoundingClientRect().bottom > 120)!;
    (window as any).__modelAnchorImage = node.querySelector(".fan-front img");
    return { id: node.dataset.gridId!, top: node.getBoundingClientRect().top };
  });
  for (const label of ["封面视图", "叠放视图"]) {
    await page.evaluate((label) => {
      document
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .click();
    }, label);
    await page.waitForTimeout(450);
    const position = await page
      .locator(`[data-grid-id="${anchor.id}"]`)
      .evaluate((node) => ({
        top: node.getBoundingClientRect().top,
        same:
          node.querySelector(".fan-front img") ===
          (window as any).__modelAnchorImage,
      }));
    expect(position.same).toBe(true);
    expect(Math.abs(position.top - anchor.top)).toBeLessThanOrEqual(1);
    expect(await page.locator("[data-grid-id]").count()).toBeLessThan(80);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

for (const preference of ["system", "app"]) {
  test(`${preference} reduced motion disables model view geometry animations`, async ({
    page,
  }) => {
    if (preference === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    else {
      await page.goto("/#/settings");
      await page
        .getByRole("navigation", { name: "设置分类" })
        .getByRole("button", { name: "高级设置" })
        .click();
      await page.getByRole("switch", { name: "减少动态效果" }).check();
    }
    await page.goto("/#/models/m0");
    for (const label of ["封面视图", "叠放视图"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
      await expect(page.locator(".fan-photo-plane").first()).toHaveCSS(
        "transform",
        "none",
      );
      await expect(page.locator("[data-grid-id]").first()).toHaveCSS(
        "transform",
        "none",
      );
    }
  });
}

for (const route of ["library", "tags", "models/m0", "favorites", "recent"]) {
  test(`${route} switching views does not restore an old scroll position`, async ({
    page,
  }) => {
    await page.goto(`/#/${route}`);
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
      const albums = db.albums;
      db.albums = Array.from({ length: 240 }, (_, index) => ({
        ...albums[index % albums.length],
        id: `scroll-${index}`,
        modelIds: ["m0"],
        favorite: true,
      }));
      db.recent = db.albums.map((album: { id: string }) => ({
        albumId: album.id,
        at: "2026-10-11T00:00:00.000Z",
      }));
      localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
    });
    await page.reload();
    await page.getByRole("button", { name: "封面视图", exact: true }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => scrollTo(0, 1400));
    await page.waitForTimeout(150);
    await page.evaluate(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="叠放视图"]')!
        .click(),
    );
    await page.waitForTimeout(450);
    await page.mouse.wheel(0, -100000);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "封面视图", exact: true }).click();
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('[data-grid-id="scroll-0"]')).toBeInViewport();
  });
}
