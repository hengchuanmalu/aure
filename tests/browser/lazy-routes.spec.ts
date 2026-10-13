import { expect, test } from '../support/browser.fixture';

test('Escape closes a viewer while its chunk is still loading and preserves the album', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/(?:src\/features\/viewer\/Viewer\.tsx|assets\/Viewer-[^/]+\.js)(?:\?.*)?$/, async route => {
    await gate; await route.continue();
  });
  await page.goto('/#/album/a0');
  await expect(page.locator('.media-layout')).toBeVisible();
  await page.evaluate(() => { (window as any).__albumGrid = document.querySelector('.media-layout'); });
  await page.locator('.media-card .media-open').first().click();
  try {
    await expect(page.getByRole('dialog', { name: '正在加载图片浏览' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/album\/a0$/);
    expect(await page.evaluate(() => (window as any).__albumGrid === document.querySelector('.media-layout'))).toBe(true);
  } finally { release(); }
  await expect(page.locator('.viewer')).toHaveCount(0);
});

test('a delayed settings chunk keeps navigation and current content mounted', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/(?:src\/pages\/Settings\.tsx|assets\/Settings-[^/]+\.js)(?:\?.*)?$/, async route => {
    await gate;
    await route.continue();
  });
  await page.goto('/#/');
  await expect(page.locator('.discovery')).toBeVisible();
  await page.evaluate(() => { (window as any).__shell = document.querySelector('.topbar'); });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
  try {
    // React Router transitions retain the existing route while Suspense waits.
    await expect(page.locator('.discovery')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__shell === document.querySelector('.topbar'))).toBe(true);
  } finally { release(); }
  await expect(page.locator('h1')).toHaveText('设置');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发现', exact: true }).click();
  await expect(page.locator('.discovery')).toBeVisible();
});
