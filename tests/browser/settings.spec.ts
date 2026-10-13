import { expect,test } from "../support/browser.fixture";

test("settings stay in the main shell and browsing preferences survive a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/settings");
  const categories = page.getByRole("navigation", { name: "设置分类" });
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(
    categories.getByRole("button", { name: "预览库", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await categories.getByRole('button', { name: '高级设置' }).click();
  await page.getByRole("switch", { name: "减少动态效果" }).check();
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "视频封面取帧位置" })
    .selectOption("50");
  await expect(
    page.getByRole("combobox", { name: "视频封面取帧位置" }),
  ).toBeEnabled();
  await page.getByRole('switch', { name: '自动轮换推荐' }).uncheck();
  await page.getByRole('combobox', { name: '推荐切换间隔' }).selectOption('15');
  await page.getByRole('combobox', { name: '推荐过渡速度' }).selectOption('400');
  await page.getByRole('switch', { name: '推荐悬停时暂停' }).uncheck();
  await categories.getByRole("button", { name: "关于" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "关于", exact: true }),
  ).toContainText("0.1.0");
  await expect(page.getByRole("switch")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  await page.reload();
  await categories.getByRole('button', { name: '高级设置' }).click();
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "视频封面取帧位置" }),
  ).toHaveValue("50");
  await expect(page.getByRole('switch', { name: '自动轮换推荐' })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: '推荐切换间隔' })).toHaveValue('15');
  await expect(page.getByRole('combobox', { name: '推荐过渡速度' })).toHaveValue('400');
  await expect(page.getByRole('switch', { name: '推荐悬停时暂停' })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("library actions export metadata and cancelling reset preserves the catalog", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const before = await page.evaluate(() =>
    localStorage.getItem("jingji.mock.v1"),
  );
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "预览库" })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("aure-preview-backup.json");
  await page.getByRole("button", { name: "重置预览库", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("磁盘原件不受影响");
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("jingji.mock.v1")),
  ).toBe(before);
});

test("all settings categories fit desktop and narrow viewports", async ({
  page,
}) => {
  await page.goto("/#/settings");
  for (const width of [1440, 1024, 600]) {
    await page.setViewportSize({ width, height: 720 });
    for (const name of ["高级设置", "预览库", "关于"]) {
      await page
        .getByRole("navigation", { name: "设置分类" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test('advanced controls change recommendation timing and persist without changing media or albums', async ({ page }) => {
  await page.goto('/#/settings');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await page.getByRole('switch', { name: '自动轮换推荐' }).uncheck();
  await page.getByRole('combobox', { name: '推荐切换间隔' }).selectOption('3');
  await page.getByRole('combobox', { name: '推荐过渡速度' }).selectOption('400');
  await page.getByRole('switch', { name: '推荐悬停时暂停' }).uncheck();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发现', exact: true }).click();
  await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'true');
  await page.waitForTimeout(3500);
  const first = await page.locator('.featured-grid[data-active="true"] h3').allTextContents();
  expect(first).toEqual(before.albums.slice(0, 5).map((album: { name: string }) => album.name));
  await page.getByRole('button', { name: '刷新推荐' }).click();
  await expect(page.locator('.featured-grid[data-active="true"] h3')).toHaveText(before.albums.slice(5, 10).map((album: { name: string }) => album.name));
  await expect(page.locator('.recommendation-carousel')).toHaveCSS('--recommendation-duration', '400ms');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await page.getByRole('switch', { name: '自动轮换推荐' }).check();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发现', exact: true }).click();
  await page.locator('.featured-grid[data-active="true"] .cover-link').first().hover();
  await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'false');
  await expect(page.locator('.featured-grid[data-active="true"] h3')).toHaveText(before.albums.slice(5, 10).map((album: { name: string }) => album.name), { timeout: 5000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  expect(after.albums).toEqual(before.albums);
  expect(after.media).toEqual(before.media);
  expect(after.models).toEqual(before.models);
});
