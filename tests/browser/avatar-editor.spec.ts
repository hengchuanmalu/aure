import { expect,test,type Page } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

async function openEditor(page: Page) {
  await page.goto('/#/models/m0');
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await expect(page.locator('.avatar-crop-stage img')).toBeVisible();
  await expect.poll(() => page.locator('.avatar-crop-stage img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));

test('photo sources select only images and preserve crop while switching collections', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByRole('button', { name: '全部图片', exact: true })).toHaveCount(0);
  await expect(page.getByText('拖动照片调整位置，方向键可微调', { exact: true })).toHaveCount(0);
  await expect(page.locator('.picker-pages')).toHaveCount(0);
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.avatar-photo-grid button')).toHaveCount(1);
  await page.getByRole('button', { name: '头像 素材 1', exact: true }).click();
  await page.getByLabel('头像缩放').fill('180');
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '光落在肩上', exact: true }).click();
  await expect(page.locator('.avatar-photo-grid button')).toHaveCount(3);
  await expect(page.getByLabel('头像缩放')).toHaveValue('180');
  await expect(page.getByRole('button', { name: '头像 素材 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '头像 素材 3', exact: true }).click();
  await expect(page.getByLabel('头像缩放')).toHaveValue('100');
  await page.getByRole('button', { name: '重置头像裁切' }).click();
  await expect(page.getByLabel('头像缩放')).toHaveValue('100');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  expect((await saved(page)).models[0].avatar).toBe(seedFixture().models[0].avatar);
});

test('drag, keyboard, save and reload share the same crop in every avatar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page);
  const originalBackground = (await saved(page)).models[0].background;
  const initialReferences = (await saved(page)).models[0].photoIds;
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '光落在肩上', exact: true }).click();
  await page.getByRole('button', { name: '头像 素材 2', exact: true }).click();
  await page.getByLabel('头像缩放').fill('175');
  const stage = page.getByRole('group', { name: '头像裁切区域' });
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await stage.press('ArrowRight');
  const previewStyle = await stage.locator('img').getAttribute('style');
  await page.screenshot({ path: 'verification/avatar-editor-browser.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const model = (await saved(page)).models[0];
  expect(model.avatarCrop.zoom).toBe(1.75);
  expect(model.avatarCrop.x).toBeLessThan(50);
  expect(model.avatarCrop.y).toBeLessThan(50);
  expect(model.background).toBe(originalBackground);
  expect(model.photoIds).toEqual(initialReferences);
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('style', previewStyle!);
  await page.reload();
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('style', previewStyle!);
  await page.goto('/#/models');
  await expect(page.locator('.model-card[href="#/models/m0"] img')).toHaveAttribute('style', previewStyle!);
  await page.goto('/#/library?model=m0');
  await expect(page.locator('.collection-context .model-avatar img')).toHaveAttribute('style', previewStyle!);
  await expect(page.locator('.model-filters button').filter({ hasText: '林夏' }).locator('.model-avatar img')).toHaveAttribute('style', previewStyle!);
  await page.goto('/#/album/a0');
  await expect(page.locator('.album-people a[href="#/models/m0"] img')).toHaveAttribute('style', previewStyle!);
  expect(errors).toEqual([]);
});

test('compact and narrow layouts keep actions visible without horizontal overflow', async ({ page }) => {
  await openEditor(page);
  for (const viewport of [{ width: 1024, height: 720 }, { width: 680, height: 720 }, { width: 520, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator('.avatar-editor-modal .dialog-content').evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    await page.screenshot({ path: `verification/avatar-editor-${viewport.width}.png` });
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('photo scrolling stays bounded and resets when switching source', async ({ page }) => {
  const db = seedFixture();
  db.media = Array.from({ length: 327 }, (_, i) => ({ ...db.media[i % 12], id: `p${i}`, favorite: true }));
  db.albums = Array.from({ length: 55 }, (_, i) => ({ ...db.albums[0], id: `a${i}`, name: `写真 ${i}`, mediaIds: ['p0', 'p1'] }));
  await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', snapshot), JSON.stringify(db));
  await openEditor(page);
  const scroll = page.getByRole('group', { name: '头像照片', exact: true });
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('button', { name: '头像 素材 327', exact: true })).toBeVisible();
  expect(await page.locator('.avatar-photo-grid button').count()).toBeLessThan(40);
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: '头像 素材 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一组写真集' }).click();
  await expect(page.getByRole('group', { name: '头像图片来源' }).getByRole('button')).toHaveCount(8);
  await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: '写真 48', exact: true }).click();
  await expect(page.locator('.avatar-photo-grid button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '头像 素材 1', exact: true })).toBeVisible();
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(0);
  await expect(page.locator('.picker-pages, input[type="number"]')).toHaveCount(0);
});

test('wheel zooms the crop without scrolling the dialog and respects both limits', async ({ page }) => {
  await openEditor(page);
  const content = page.locator('.avatar-editor-modal .dialog-content');
  const before = await content.evaluate(element => element.scrollTop);
  const stage = page.getByRole('group', { name: '头像裁切区域', exact: true });
  await stage.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.getByLabel('头像缩放').inputValue()).toBe('111');
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.getByLabel('头像缩放').inputValue()).toBe('100');
  await page.getByLabel('头像缩放').fill('300');
  await stage.hover();
  await page.mouse.wheel(0, -100);
  await expect(page.getByLabel('头像缩放')).toHaveValue('300');
  await page.getByLabel('头像缩放').fill('100');
  await stage.hover();
  await page.mouse.wheel(0, 100);
  await expect(page.getByLabel('头像缩放')).toHaveValue('100');
  expect(await content.evaluate(element => element.scrollTop)).toBe(before);
});
