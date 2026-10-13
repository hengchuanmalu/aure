import { expect, test } from "../support/browser.fixture";

for (const { route, count, back } of [
  { route: "favorites", count: 2, back: "返回收藏" },
  { route: "recent", count: 1, back: "返回最近浏览" },
]) {
  test(`${route} view survives reload and returning from an album`, async ({
    page,
  }) => {
    await page.goto(`/#/${route}?sort=name`);
    await expect(page.locator(".album-card--stack")).toHaveCount(count);
    await page.getByRole("button", { name: "封面视图", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`${route}\\?sort=name&view=cover$`),
    );
    await expect(page.locator(".album-card--cover")).toHaveCount(count);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "封面视图", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.locator(".cover-link").first().click();
    await page.getByRole("button", { name: back, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`${route}\\?sort=name&view=cover$`),
    );
    await expect(page.locator(".album-card--cover")).toHaveCount(count);
    const stack = page.getByRole("button", { name: "叠放视图", exact: true });
    await stack.focus();
    await stack.press("Enter");
    await expect(stack).toBeFocused();
    await expect(stack).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".album-card--stack")).toHaveCount(count);
  });
}

test("favorites view switch only controls albums and retains the selection across tabs", async ({
  page,
}) => {
  await page.goto("/#/favorites");
  await page.getByRole("button", { name: "封面视图", exact: true }).click();
  await page.getByRole("button", { name: /^照片与视频/ }).click();
  await expect(page.getByRole("group", { name: "写真集展示方式" })).toHaveCount(
    0,
  );
  await expect(page.locator(".media-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^写真集 ·/ }).click();
  await expect(
    page.getByRole("button", { name: "封面视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".album-card--cover")).toHaveCount(2);
});

test("discovery has no album view switch", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("group", { name: "写真集展示方式" })).toHaveCount(
    0,
  );
});
