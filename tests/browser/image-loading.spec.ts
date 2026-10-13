import { expect,test } from "../support/browser.fixture";

test('stacked covers share a static placeholder without exposing pending image content', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tests/fixtures/media/*.jpg', async route => { await gate; await route.continue(); });
  await page.goto('/#/library', { waitUntil: 'domcontentloaded' });
  const frame = page.locator('.fan-front .photo-frame').first();
  await expect(frame).toHaveAttribute('data-photo-state', 'loading');
  await expect(frame.locator('img')).toHaveCSS('visibility', 'hidden');
  expect(await frame.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toContain('aure-placeholder.webp');
  // The bitmap plane adopts the decoded image's ratio; its visible crop stays fixed.
  const viewport = page.locator('.fan-front').first();
  const before = await viewport.boundingBox();
  await page.screenshot({ path: 'test-results/placeholder-stack-loading.png' });
  release();
  await expect(frame).toHaveAttribute('data-photo-state', 'ready');
  await expect(frame.locator('img')).toHaveCSS('visibility', 'visible');
  expect(await viewport.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/media/aure-placeholder.webp')).length)).toBe(1);
});

test('photo and video covers use the same placeholder, then reveal decoded content', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tests/fixtures/media/*.jpg', async route => { await gate; await route.continue(); });
  await page.goto('/#/album/a0', { waitUntil: 'domcontentloaded' });
  for (const kind of ['image', 'video']) {
    const card = page.locator(`[data-media-kind="${kind}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.photo-frame')).toHaveAttribute('data-photo-state', 'loading');
    await expect(card.locator('img')).toHaveCSS('visibility', 'hidden');
  }
  release();
  await expect(page.locator('[data-media-kind="video"] .photo-frame').first()).toHaveAttribute('data-photo-state', 'ready');
});

test('failed cover hides the broken image and supports retry', async ({ page }) => {
  const source = '**/tests/fixtures/media/p-1239291.jpg';
  await page.route(source, route => route.abort());
  await page.goto('/#/album/a0');
  const cover = page.locator('.album-cover-trigger .photo-frame');
  await expect(cover).toHaveAttribute('data-photo-state', 'error');
  await expect(cover.locator('img')).toHaveCount(0);
  expect(await cover.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toContain('aure-placeholder.webp');
  await page.unroute(source);
  await page.locator('.album-hero').getByRole('button', { name: '重试', exact: true }).click();
  await expect(cover).toHaveAttribute('data-photo-state', 'ready');
});

test('viewer retry reveals the recovered original after a load error', async ({ page }) => {
  const source='**/tests/fixtures/media/p-1239291.jpg';
  await page.route(source,route=>route.abort());
  await page.goto('/#/viewer/a0/p0');
  await expect(page.locator('.viewer-error')).toBeVisible();
  await page.unroute(source);
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state','ready');
  await expect(page.locator('.media-stage > img')).toHaveCSS('visibility','visible');
  await expect(page.locator('.viewer-error')).toHaveCount(0);
});

test('viewer conceals a pending original and ignores its completion after switching', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tests/fixtures/media/p-1239291.jpg', async route => { await gate; await route.continue(); });
  await page.goto('/#/viewer/a0/p0', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'loading');
  await expect(page.locator('.media-stage > img')).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: 'test-results/placeholder-viewer-loading.png' });
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/p1$/);
  await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready');
  release();
  await expect(page.locator('.media-stage > img')).toHaveAttribute('src', /p-774909/);
  await expect(page.locator('.viewer-media-placeholder')).toHaveCount(0);
});
