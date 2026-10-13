import { expect,test } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

test.beforeEach(async ({ page }) => {
  const db = seedFixture();
  db.albums[0].mediaIds = ['v0', 'v1'];
  await page.addInitScript(snapshot => {
    if (!sessionStorage.getItem('video-preview-fixture')) {
      localStorage.setItem('jingji.mock.v1', snapshot);
      sessionStorage.setItem('video-preview-fixture', '1');
    }
  }, JSON.stringify(db));
  await page.goto('/#/album/a0');
});

test('hover previews are muted, exclusive, show progress and release on leave', async ({ page }) => {
  const first = page.locator('[data-media-id="v0"]');
  const second = page.locator('[data-media-id="v1"]');
  await expect(first.locator('.video-cover-trigger')).toHaveCount(0);
  await first.hover();
  await expect(first).toHaveAttribute('data-preview', 'playing');
  await expect(first.getByRole('progressbar')).toBeVisible();
  expect(await first.locator('video').evaluate(v => v.muted)).toBe(true);
  await expect.poll(() => first.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
  await second.hover();
  await expect(first).toHaveAttribute('data-preview', 'idle');
  expect(await first.locator('video').getAttribute('src')).toBeNull();
  await expect(second).toHaveAttribute('data-preview', 'playing');
  await page.mouse.move(0, 0);
  await expect(second).toHaveAttribute('data-preview', 'idle');
  expect(await second.locator('video').getAttribute('src')).toBeNull();
});

test('keyboard preview honors reduced motion and does not record a visit', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const card = page.locator('[data-media-id="v0"]');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).recent);
  await card.getByRole('button', { name: '打开 flower.mp4', exact: true }).focus();
  await expect(card).toHaveAttribute('data-preview', 'playing');
  expect(await card.locator('.preview-bars i').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('link', { name: 'aure首页', exact: true }).focus();
  await expect(card).toHaveAttribute('data-preview', 'idle');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).recent)).toEqual(before);
});

test('leaving during dwell cancels playback and failed previews keep the card usable', async ({ page }) => {
  const card = page.locator('[data-media-id="v0"]');
  await card.hover();
  await expect(card).toHaveAttribute('data-preview', 'pending');
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute('data-preview', 'idle');
  expect(await card.locator('video').getAttribute('src')).toBeNull();
  await page.route('**/flower.mp4', route => route.abort());
  await card.hover();
  await expect(card).toHaveAttribute('data-preview', 'error');
  await expect(card).toContainText('无法预览');
  await expect(card.getByRole('button', { name: '打开 flower.mp4', exact: true })).toBeEnabled();
});

test('video cover position is a persistent global setting', async ({ page }) => {
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  const select = page.getByRole('combobox', { name: '视频封面取帧位置' });
  await expect(select).toHaveValue('10');
  await select.selectOption('90');
  await expect(select).toBeEnabled();
  await page.reload();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await expect(select).toHaveValue('90');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).settings.videoPosterPercent)).toBe(90);
  await page.goto('/#/album/a0');
  const card = page.locator('[data-media-id="v0"]');
  await expect(card.locator('.video-cover-trigger')).toHaveCount(0);
  await card.hover();
  await expect(card).toHaveAttribute('data-preview', 'playing');
});
