import { expect,test } from "../support/browser.fixture";

test("entire album cover opens details while actions stay independent", async ({
  page,
}) => {
  for (const area of ["image", "title", "tag", "count", "overlay-space"]) {
    await page.goto("/#/library");
    const card = page.locator(".album-card").first();
    await expect(page.locator('.page-content > div')).toHaveCSS('transform', 'none');
    await expect(card).toHaveCSS('transform', 'none');
    await card.hover();
    await expect(card.locator(".album-overlay")).toHaveCSS("opacity", "1");
    const box = await card.boundingBox();
    if (!box) throw Error("Card not visible");
    if (area === "image" || area === "overlay-space") {
      await page.mouse.click(
        box.x + box.width * 0.5,
        box.y + box.height * (area === "image" ? 0.1 : 0.45),
      );
    } else {
      const target = card
        .locator(
          area === "title"
            ? "h3"
            : area === "tag"
              ? ".chip"
              : ".card-bottom small",
        )
        .first();
      const point = await target.boundingBox();
      if (!point) throw Error("Overlay content not visible");
      await page.mouse.click(
        point.x + point.width / 2,
        point.y + point.height / 2,
      );
    }
    await expect(page).toHaveURL(/#\/album\/a0$/);
  }
  await page.goto("/#/library");
  const card = page.locator(".album-card").first();
  await card.hover();
  await card
    .getByRole("button", { name: "取消收藏 光落在肩上", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(
    card.getByRole("button", { name: "收藏 光落在肩上", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "光落在肩上 更多操作", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "编辑写真集" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/library$/);
  await page.keyboard.press("Escape");
  await card.getByRole("link", { name: "打开写真 光落在肩上" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/album\/a0$/);
});
