import { expect,test } from "../support/browser.fixture";

const saved = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
const openBackground = async (page: import('@playwright/test').Page) => {
  await page.goto('/#/models/m0');
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '背景图片', exact: true }).click();
};

test('background source selection, crop, preview, save, reload and cancel preserve avatar and originals', async ({ page }) => {
  await openBackground(page);
  const before = (await saved(page)).models[0];
  await expect(page.getByRole('button', { name: '全部图片', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '移除背景', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '背景预览', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '页面效果', exact: true })).toBeVisible();
  for (const selector of ['.background-crop-stage', '.background-page-effect .model-background']) {
    const size = (await page.locator(selector).boundingBox())!;
    expect(size.width / size.height).toBeCloseTo(16 / 9, 1);
  }
  await page.getByRole('button', { name: '关联写真集', exact: true }).last().click();
  await page.getByRole('group', { name: '背景来源写真集' }).getByRole('button', { name: '光落在肩上', exact: true }).click();
  await page.getByRole('button', { name: '背景 素材 2', exact: true }).click();
  const stage = page.getByRole('group', { name: '背景裁切区域' });
  await expect.poll(() => stage.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByLabel('背景缩放').fill('175');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await stage.press('ArrowRight');
  const previewStyle = await stage.locator('img').getAttribute('style');
  await expect(page.locator('.background-page-effect .model-background img')).toHaveAttribute('style', previewStyle!);
  await page.screenshot({ path: 'verification/background-editor/browser.png', animations: 'disabled' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = (await saved(page)).models[0];
  expect(after.avatar).toBe(before.avatar);
  expect(after.avatarCrop).toEqual(before.avatarCrop);
  expect(after.photoIds).toEqual(before.photoIds);
  expect(after.backgroundCrop.zoom).toBe(1.75);
  expect(after.backgroundCrop.y).toBeLessThan(50);
  await expect(page.locator('.model-backdrop img')).toHaveAttribute('style', previewStyle!);
  const backdrop = (await page.locator('.model-backdrop').boundingBox())!;
  expect(backdrop.width / backdrop.height).toBeCloseTo(16 / 9, 1);
  expect(backdrop.width).toBeLessThanOrEqual(720);
  await page.reload();
  await expect(page.locator('.model-backdrop img')).toHaveAttribute('style', previewStyle!);
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '背景图片', exact: true }).click();
  await page.getByLabel('背景缩放').fill('200');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  expect((await saved(page)).models[0].background).toBe(after.background);
  expect((await saved(page)).models[0].backgroundCrop).toEqual(after.backgroundCrop);
  expect((await saved(page)).models[0].avatar).toBe(before.avatar);
});

test('background reset, zoom wheel and compact layouts keep actions available', async ({ page }) => {
  await openBackground(page);
  await page.getByLabel('背景缩放').fill('150');
  await page.getByRole('group', { name: '背景裁切区域' }).hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.getByLabel('背景缩放').inputValue()).toBe('166');
  await page.getByRole('button', { name: '重置背景裁切', exact: true }).click();
  await expect(page.getByLabel('背景缩放')).toHaveValue('100');
  // Large portrait originals must not determine the size of the crop stage.
  await page.locator('.background-crop-stage img').evaluate(image => {
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="14000"><rect width="4000" height="14000" fill="lightblue"/></svg>');
  });
  await expect.poll(() => page.locator('.background-crop-stage img').evaluate(image => image.naturalHeight)).toBe(14000);
  for (const viewport of [{ width: 1282, height: 780 }, { width: 1024, height: 720 }, { width: 680, height: 720 }, { width: 520, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (viewport.width > 620) {
      await expect(page.locator('.background-page-effect')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '从本地选择图片', exact: true })).toBeInViewport({ ratio: 1 });
      await expect.poll(() => page.locator('.dialog-content').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
});
