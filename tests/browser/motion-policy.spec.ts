import { expect,test } from "../support/browser.fixture";

test("system preference changes live, the app override wins, and portals share the policy", async ({
  page,
}) => {
  await page.goto("/#/library");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.locator(".album-card").first().hover();
  await page
    .locator(".album-card")
    .first()
    .getByRole("button", { name: /更多操作$/ })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toHaveCSS("animation-name", "none");
  await expect(menu).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "高级设置", exact: true }).click();
  await page.getByRole("switch", { name: "减少动态效果" }).check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "写真库", exact: true })
    .click();
  await page.getByRole("button", { name: "添加写真", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("returning to the library preserves position without replaying card entrances", async ({
  page,
}) => {
  await page.goto("/#/library");
  await page.evaluate(() => window.scrollTo(0, 400));
  const scroll = await page.evaluate(() => window.scrollY);
  await page.locator(".album-card .cover-link").nth(5).click();
  await expect(
    page.getByRole("button", { name: "返回写真库", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeCloseTo(scroll, 0);
  await expect(page.locator(".page-content > div")).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator(".album-card").first()).toHaveCSS("opacity", "1");
  expect(
    await page
      .locator(".album-card")
      .evaluateAll((cards) =>
        cards.every(
          (card) =>
            getComputedStyle(card).transform === "none" &&
            card.getAnimations().length === 0,
        ),
      ),
  ).toBe(true);
});

test("rapid model choices settle correctly without a filter panel", async ({ page }) => {
  await page.goto("/#/library");
  await expect(page.getByRole("button", { name: "筛选", exact: true })).toHaveCount(0);
  await expect(page.locator("#library-filters")).toHaveCount(0);
  await page.locator(".model-filters button").nth(1).click();
  await page.locator(".model-filters button").nth(2).click();
  await page.locator(".model-filters button").first().click();
  await expect(page.locator(".album-grid .album-card")).toHaveCount(12);
  await expect(page.locator(".collection-context")).toHaveCount(0);
});

test("reducing motion during recommendation transition settles the decoded target and keeps refresh usable", async ({
  page,
}) => {
  await page.goto("/");
  const carousel = page.locator(".recommendation-carousel");
  const refresh = page.getByRole("button", { name: "刷新推荐" });
  const initial = await page
    .locator(".featured-grid[data-active=true] h3")
    .allTextContents();
  await refresh.click();
  await expect(carousel).toHaveAttribute("data-transitioning", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(carousel).toHaveAttribute("data-transitioning", "false");
  await expect(refresh).toBeEnabled();
  expect(
    await page.locator(".featured-grid[data-active=true] h3").allTextContents(),
  ).not.toEqual(initial);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(carousel).toHaveAttribute("data-paused", "true");
});

test("hidden auxiliary rails have no hidden tab stops and keyboard focus can reveal them", async ({
  page,
}) => {
  await page.goto("/#/models");
  const zone = page.getByRole("group", { name: "显示模特字母索引" });
  const index = page.locator(".model-index");
  await expect(index).toHaveCSS("opacity", "0");
  await expect(index).toHaveAttribute("inert", "");
  await zone.focus();
  await expect(index).toHaveCSS("opacity", "1");
  await expect(zone).toHaveCSS("outline-style", "none");
  await expect(index).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  expect(
    await index.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.getByRole("button", { name: "显示全部模特", exact: true }).focus();
  await expect(index).toHaveCSS("opacity", "0");
  await page.goto("/#/viewer/a0/p0");
  const rail = page.locator(".viewer-filmstrip");
  await page.locator(".viewer-filmstrip-zone").hover();
  await page.mouse.move(700, 300);
  await expect(rail).toHaveAttribute("inert", "");
  await page.getByRole("group", { name: "显示写真集缩略图" }).focus();
  await expect(rail).toHaveCSS("opacity", "1");
  await expect(rail).toHaveCSS("outline-style", "solid");
  await expect(rail).not.toHaveAttribute("inert", "");
});
