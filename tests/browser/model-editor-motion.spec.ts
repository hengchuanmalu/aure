import { test, expect } from "../support/browser.fixture";
import { verifyModelEditorMotion } from "../support/model-editor-motion.mjs";

test("all profile columns resize smoothly and the selection stays inside the navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/models/m0");
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem("jingji.mock.v1"),
  );
  await page.getByLabel("模特名称", { exact: true }).fill("切换保留草稿");
  await verifyModelEditorMotion(page);
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    "切换保留草稿",
  );
  await page.screenshot({
    path: "verification/model-editor-motion/browser.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await verifyModelEditorMotion(page);
  for (const viewport of [
    { width: 1024, height: 720 },
    { width: 520, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await page
        .locator(".model-editor-tabs")
        .evaluate(
          (nav, index) =>
            nav.querySelectorAll<HTMLButtonElement>("button")[index].click(),
          index,
        );
      await expect(
        page.getByRole("button", { name: "保存", exact: true }),
      ).toBeInViewport();
      await expect
        .poll(() =>
          page
            .getByRole("dialog")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        )
        .toBe(true);
    }
  }
  await page
    .locator(".model-editor-tabs")
    .getByRole("button", { name: "基本资料", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    "切换保留草稿",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("jingji.mock.v1")),
  ).toBe(before);
  expect(errors).toEqual([]);
});
