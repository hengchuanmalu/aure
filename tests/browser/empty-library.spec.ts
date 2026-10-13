import { expect,test } from '@playwright/test';

test('a new library has no bundled examples and offers folder import', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('还没有写真集', { exact: true })).toBeVisible();
  await expect(page.locator('.album-card, .model-card')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('jingji.mock.v1'))).toBeNull();
  await page.getByRole('link', { name: '导入写真', exact: true }).click();
  await expect(page.getByRole('button', { name: '从文件夹导入', exact: true })).toBeVisible();
  await expect(page.locator('.media-picker > button')).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/#/models');
  await page.locator('.topbar').getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await expect(page.getByText('选择一张照片作为头像', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无收藏的图片', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '头像图片来源' }).getByRole('button')).toHaveCount(1);
  await expect(page.locator('.avatar-photo-grid button')).toHaveCount(0);
  await expect(page.getByLabel('头像缩放')).toBeDisabled();
});
