import { expect,test } from "../support/browser.fixture";

const routes = ['/', '/library', '/models', '/tags', '/tags/manage', '/favorites', '/recent', '/settings'];

for (const width of [2300, 1440, 900, 480]) {
  test(`search and page titles retain their positions across pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    let baseline: { searchX: number; searchY: number; searchWidth: number; titleX: number; titleY: number } | undefined;
    for (const route of routes) {
      await page.goto(`/#${route}`);
      const title = page.locator('.page-heading h1');
      await expect(title).toBeVisible();
      const searchBox = await page.locator('.search-form').boundingBox();
      const titleBox = await title.boundingBox();
      const current = { searchX: searchBox!.x, searchY: searchBox!.y, searchWidth: searchBox!.width, titleX: titleBox!.x, titleY: titleBox!.y };
      baseline ??= current;
      for (const key of Object.keys(current) as (keyof typeof current)[]) {
        expect(Math.abs(current[key] - baseline[key]), `${route}: ${key}`).toBeLessThan(1);
      }
      const topbar = await page.locator('.topbar').boundingBox();
      const action = await page.locator('.topbar-action-group > button').boundingBox();
      expect(action!.x + action!.width).toBeLessThanOrEqual(topbar!.x + topbar!.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
  test(`library and tag headings and filter capsules match at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    let baseline: Record<string, number | string> | undefined;
    for (const route of ['/library', '/tags']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.page-heading h1')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const title = document.querySelector('.page-heading h1')!.getBoundingClientRect();
        const chip = document.querySelector<HTMLElement>('.model-filters .entity-chip, .tag-browse-all')!;
        const r = chip.getBoundingClientRect(), css = getComputedStyle(chip);
        const icon = chip.querySelector('svg')!.getBoundingClientRect();
        return { titleX: title.x, titleY: title.y, chipX: r.x, chipY: r.y, chipHeight: r.height,
          fontSize: css.fontSize, paddingLeft: css.paddingLeft, paddingRight: css.paddingRight,
          iconWidth: icon.width, iconHeight: icon.height, radius: css.borderRadius };
      });
      baseline ??= geometry;
      expect(geometry, route).toEqual(baseline);
      const sizes = await page.locator('.model-filters .entity-chip, .tag-browse-all, .tag-browse-chip, .tag-browse-model').evaluateAll(chips => chips.map(chip => ({ height: chip.getBoundingClientRect().height, font: getComputedStyle(chip).fontSize })));
      expect(sizes.every(size => size.height === geometry.chipHeight && size.font === geometry.fontSize)).toBe(true);
      const avatarSizes = await page.locator('.model-filters .model-avatar, .tag-browse-model .model-avatar').evaluateAll(avatars => avatars.map(avatar => avatar.getBoundingClientRect().width));
      expect(avatarSizes.every(size => size === 22)).toBe(true);
    }
  });
}

test('add-photo entry opens the matching editor and global search remains keyboard accessible', async ({ page }) => {
  await page.goto('/#/');
  await page.locator('.topbar').getByRole('button', { name: '添加写真', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加写真', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '从文件夹导入', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.topbar-action-group > button')).toBeFocused();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: '搜索写真、模特或标签', exact: true });
  await expect(search).toBeFocused();
  await search.fill('林夏');
  await search.press('Enter');
  await expect(page).toHaveURL(/#\/library\?q=/);
  await expect(search).toHaveValue('林夏');
});
