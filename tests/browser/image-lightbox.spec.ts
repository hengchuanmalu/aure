import { expect,test } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

test.beforeEach(async ({ page }) => {
  const db = seedFixture();
  db.models[0].avatarCrop = { x: 31, y: 72, zoom: 1.6 };
  db.models[0].backgroundCrop = { x: 68, y: 23, zoom: 1.4 };
  await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', snapshot), JSON.stringify(db));
});

test('avatar preview preserves the circular crop, has no visible text, and closes on blank space', async ({ page }) => {
  await page.goto('/#/models/m0');
  const trigger = page.getByRole('button', { name: '查看头像大图' });
  const sourceStyle = await trigger.locator('img').getAttribute('style');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const frame = dialog.locator('.image-lightbox-crop');
  await expect.poll(() => frame.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const actual = await frame.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, radius: getComputedStyle(element).borderRadius };
  });
  expect(actual.width).toBeCloseTo(actual.height, 0);
  expect(actual.radius).toBe('50%');
  expect(await frame.locator('img').getAttribute('style')).toBe(sourceStyle);
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS('clip-path', 'inset(50%)');
  expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(dialog.getByRole('button')).toHaveCount(0);
  await frame.click();
  await expect(dialog).toBeVisible();
  const box = await frame.boundingBox();
  // The corners of the circle are blank, too.
  await page.mouse.click(box!.x + 2, box!.y + 2);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('background preview uses the saved widescreen crop and fits small windows', async ({ page }) => {
  await page.goto('/#/models/m0');
  const trigger = page.getByRole('button', { name: '查看背景大图' });
  const sourceStyle = await trigger.locator('img').getAttribute('style');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const frame = dialog.locator('.image-lightbox-crop');
  expect(await frame.locator('img').getAttribute('style')).toBe(sourceStyle);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 600, height: 700 }]) {
    await page.setViewportSize(viewport);
    const bounds = await frame.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 2);
    await expect(frame).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS('clip-path', 'inset(50%)');
  }
  await frame.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
});

test('cover preview preserves the displayed cover composition and closes on blank space', async ({ page }) => {
  await page.goto('/#/album/a0');
  const trigger = page.getByRole('button', { name: '查看封面大图' });
  const cover = await trigger.boundingBox();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const frame = dialog.locator('.image-lightbox-crop');
  const preview = await frame.boundingBox();
  expect(preview!.width / preview!.height).toBeCloseTo(cover!.width / cover!.height, 2);
  expect(await frame.locator('img').evaluate(image => getComputedStyle(image).objectPosition)).toBe('50% 25%');
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCSS('clip-path', 'inset(50%)');
  await expect(dialog.getByRole('button')).toHaveCount(0);
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
});
