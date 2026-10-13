import { expect,test } from "../support/browser.fixture";

test("shared hints use a white surface, follow controls, dismiss and preserve clicks", async ({
  page,
}) => {
  await page.goto("/#/library");
  const button = page.getByRole("button", { name: "封面视图", exact: true });
  await button.hover();
  const hint = page.locator(".hover-hint");
  await expect(hint).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveText("封面视图");
  await expect(hint).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(hint).toHaveCSS("color", "rgb(23, 23, 23)");
  await expect(hint).toHaveAttribute("data-side", "bottom");
  const anchor = (await button.boundingBox())!;
  const surface = (await hint.boundingBox())!;
  expect(Math.abs(surface.y - anchor.y - anchor.height - 4)).toBeLessThan(1);
  expect(
    Math.abs(surface.x + surface.width / 2 - anchor.x - anchor.width / 2),
  ).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveCount(0);
  await page.locator("h1").hover();
  await button.blur();
  await page.keyboard.press("Tab");
  await button.focus();
  await expect(page.getByRole("tooltip")).toHaveText("封面视图");
  await page.locator("h1").click();
  await expect(hint).toHaveCount(0);
  await expect(button).not.toHaveAttribute("title");
});

test("sidebar and previously unlabelled icon actions have no hints while menu clicks still work", async ({
  page,
}) => {
  await page.goto("/#/library");
  const nav = page.getByRole("navigation", { name: "主导航" });
  for (const link of await nav.getByRole('link').all()) {
    await link.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await page.locator('.album-card').first().getByRole('button', { name: /收藏 / }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const menuButton = page
    .locator(".album-card")
    .first()
    .getByRole("button", { name: /更多操作/ });
  await menuButton.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await menuButton.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.locator(".hover-hint")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("previously unlabelled dialog and zoom buttons stay silent; the existing fit hint retains styling and collision", async ({
  page,
}) => {
  await page.goto("/#/album/a0");
  await page.getByRole("button", { name: "编辑写真集", exact: true }).click();
  const reset = page.getByRole("button", { name: "恢复默认封面", exact: true });
  await reset.hover();
  await expect(page.getByRole("tooltip", {name: '恢复默认封面'})).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.goto("/#/viewer/a0/p0");
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.getByRole("button", { name: "放大", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const zoom = page.locator('.viewer-image-tools button').filter({ hasText: /%/ });
  await zoom.hover();
  await expect(page.getByRole("tooltip")).toHaveText("适应窗口 · 0");
  await expect(page.locator('.hover-hint')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const box = (await page.locator(".hover-hint").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y + box.height).toBeLessThanOrEqual(592);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hover-hint")).toHaveCSS("animation-name", "none");
  await page.screenshot({ path: "verification/tooltips/browser-viewer.png" });
  // Move this fixture control to the edge to exercise the collision branch.
  await page.addStyleTag({ content: '.viewer-image-tools { bottom: 4px; z-index: 10; }' });
  await page.mouse.move(0, 0);
  await zoom.hover();
  await expect(page.locator(".hover-hint")).toHaveAttribute("data-side", "top");
  const edge = (await page.locator('.hover-hint').boundingBox())!;
  expect(edge.y + edge.height).toBeLessThanOrEqual(592);
  await page.getByRole("button", { name: "返回详情", exact: true }).click();
  await expect(page.locator(".hover-hint")).toHaveCount(0);
});

test("photo filenames share the hint and selecting a photo still updates the draft", async ({
  page,
}) => {
  await page.goto("/#/models/m0");
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByRole("button", { name: "模特头像", exact: true }).click();
  const source = page
    .getByRole("group", { name: "头像图片来源" })
    .getByRole("button", { name: "光落在肩上", exact: true });
  await source.hover();
  await expect(page.getByRole("tooltip")).toHaveText("光落在肩上");
  await source.click();
  await expect(page.locator('.hover-hint')).toHaveCount(0);
  const photo = page.getByRole("button", { name: "头像 素材 3", exact: true });
  await photo.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.locator(".hover-hint")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(photo).not.toHaveAttribute("title");
  await photo.click();
  await expect(photo).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
});
