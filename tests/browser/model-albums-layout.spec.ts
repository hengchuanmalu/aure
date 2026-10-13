import { expect, test } from "../support/browser.fixture";

for (const view of ["stack", "cover"])
  test(`model ${view} albums wrap into rows and browse vertically`, async ({
    page,
  }) => {
    await page.goto(`/#/models/m0${view === "cover" ? "?view=cover" : ""}`);
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
      db.albums.forEach((album: { modelIds: string[] }) => {
        album.modelIds = ["m0"];
      });
      localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
    });
    await page.reload();
    const section = page.getByRole("region", {
      name: "关联写真集",
      exact: true,
    });
    const cards = section.locator(".album-card");
    await expect(cards).toHaveCount(12);
    await expect(section.locator(".rail")).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: /向[左右]滚动/ }),
    ).toHaveCount(0);
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 720 });
      await expect
        .poll(() =>
          cards.evaluateAll(
            (items) =>
              new Set(
                items.map((item) =>
                  Math.round(item.getBoundingClientRect().top),
                ),
              ).size,
          ),
        )
        .toBeGreaterThan(1);
      expect(
        await section.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await cards.first().scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await cards.last().scrollIntoViewIfNeeded();
      await expect(cards.last()).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    }
    await page.screenshot({
      path: `verification/model-albums-${view}-browser.png`,
    });
    await expect(
      section.getByRole("link", { name: "查看全部", exact: true }),
    ).toHaveCount(0);
  });
