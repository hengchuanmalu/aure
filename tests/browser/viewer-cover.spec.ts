import { expect,test } from "../support/browser.fixture";

test('the cover icon precedes favorite and persists only the current album cover', async ({ page }) => {
  await page.goto('/#/viewer/a0/p1');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  const button = page.getByRole('button', { name: '设为封面', exact: true });
  await expect(button).toBeVisible();
  await expect(page.locator('.viewer-actions > button').first()).toHaveAccessibleName('设为封面');
  const coverBox = await button.boundingBox();
  const favoriteBox = await page.locator('.viewer-actions > button').nth(1).boundingBox();
  expect(coverBox!.x + coverBox!.width).toBeLessThan(favoriteBox!.x);
  const stage = await page.locator('.media-stage').boundingBox();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('已设为写真集封面');
  expect(await page.locator('.media-stage').boundingBox()).toEqual(stage);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  expect(after.albums[0].coverMediaId).toBe('p1');
  expect(after.albums[0].cover).toBe(after.media.find((item: { id: string }) => item.id === 'p1').src);
  expect(after.albums[0].mediaIds).toEqual(before.albums[0].mediaIds);
  expect(after.albums.slice(1)).toEqual(before.albums.slice(1));
  expect(after.media).toEqual(before.media);
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/album\/a0$/);
  await expect(page.getByRole('button', { name: '查看封面大图', exact: true }).locator('img')).toHaveAttribute('src', after.albums[0].cover);
});

test('cover save failure keeps the image and existing cover and permits retry', async ({ page }) => {
  await page.goto('/#/viewer/a0/p1');
  const originalCover = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].cover);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw Error('simulated storage failure'); }; });
  const button = page.getByRole('button', { name: '设为封面', exact: true });
  await button.click();
  await expect(page.getByRole('status')).toContainText('设置封面失败，请重试');
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.media-stage img')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].cover)).toBe(originalCover);
  await page.reload();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('videos and browsing without an album have no set-cover action', async ({ page }) => {
  for (const route of ['/viewer/a0/v0', '/viewer/favorites/p1', '/viewer/profile-m0/p0']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('.viewer')).toBeVisible();
    await expect(page.getByRole('button', { name: '设为封面', exact: true })).toHaveCount(0);
  }
});
