import { expect,test } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

test('model album returns to its model and retains the source scroll through filters, editing and photo viewing', async ({ page }) => {
  const db = seedFixture();
  db.albums = Array.from({ length: 64 }, (_, i) => ({ ...db.albums[0], id: `source-${i}`, name: `关联写真 ${i}`, modelIds: ['m0'] }));
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), db);
  await page.goto('/#/models/m0');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const card = page.getByRole('link', { name: '打开写真 关联写真 63', exact: true });
  await expect(card).toBeVisible();
  await page.evaluate(() => document.addEventListener('pointerdown', () => { (window as any).__modelScroll = scrollY; }, { once: true, capture: true }));
  await card.click();
  await expect(page.getByRole('button', { name: '返回模特', exact: true })).toBeVisible();
  await page.locator('.album-content-toolbar').getByRole('button', { name: '照片', exact: true }).click();
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.media-card .media-open').first().click();
  await expect(page.locator('.viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await page.getByRole('button', { name: '返回模特', exact: true }).click();
  await expect(page).toHaveURL(/#\/models\/m0$/);
  await expect.poll(() => page.evaluate(() => Math.abs(scrollY - (window as any).__modelScroll))).toBeLessThan(2);
});

test('library album returns to the same sort and view; direct album links fall back to library', async ({ page }) => {
  await page.goto('/#/library?sort=name&order=desc&view=cover');
  await page.locator('.album-card .cover-link').first().click();
  await page.getByRole('button', { name: '返回写真库', exact: true }).click();
  await expect(page).toHaveURL(/#\/library\?sort=name&order=desc&view=cover$/);
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '返回写真库', exact: true }).click();
  await expect(page).toHaveURL(/#\/library$/);
});

test('opening the model album editor from the card menu preserves the model origin', async ({ page }) => {
  await page.goto('/#/models/m0');
  const card = page.locator('.album-card').first();
  await card.hover();
  await card.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '编辑写真集', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '返回模特', exact: true }).click();
  await expect(page).toHaveURL(/#\/models\/m0$/);
});
