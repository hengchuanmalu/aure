import { expect,test } from "../support/browser.fixture";
import { photos,seedFixture } from "../support/demo.fixture";

const active = '.featured-grid[data-active="true"]';
const titles = (page: import('@playwright/test').Page) => page.locator(`${active} h3`).allTextContents();

test('all five rotate together, wrap without duplicates, and keep their layout and correct album actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const seed = seedFixture();
  await expect(page.locator(`${active} h3`)).toHaveText(seed.albums.slice(0, 5).map(album => album.name));
  const before = await page.locator(`${active} > .album-card`).evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect(); return { x, y, width, height };
  }));
  const refresh = page.getByRole('button', { name: '刷新推荐' });
  await expect(page.locator('.featured-section').getByText('全部写真', { exact: true })).toHaveCount(0);
  expect(await refresh.getAttribute('title')).toBeNull();
  await expect(page.locator('.recommendation-carousel button[aria-label*="推荐"]')).toHaveCount(0);
  expect(await refresh.evaluate(button => document.querySelector('.featured-section > .section-title')!.contains(button))).toBe(true);
  await refresh.click();
  await expect(page.locator(`${active} h3`)).toHaveText(seed.albums.slice(5, 10).map(album => album.name));
  expect(await page.locator(`${active} > .album-card`).evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect(); return { x, y, width, height };
  }))).toEqual(before);
  await expect.poll(() => page.locator(`${active} img`).evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await refresh.click();
  await expect(page.locator(`${active} h3`)).toHaveText([10, 11, 0, 1, 2].map(index => seed.albums[index].name));
  expect(new Set(await titles(page)).size).toBe(5);
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`${active} h3`)).toHaveText(seed.albums.slice(3, 8).map(album => album.name));
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('jingji.mock.v1')!))).toEqual(seed);
  await page.locator(`${active} .cover-link`).first().click();
  await expect(page).toHaveURL(/#\/album\/a3$/);
  expect(errors).toEqual([]);
});

test('automatic rotation pauses for hover, focus and menus', async ({ page }) => {
  await page.goto('/');
  const first = seedFixture().albums.slice(0, 5).map(album => album.name);
  await page.locator(`${active} .cover-link`).first().hover();
  await page.waitForTimeout(6500);
  expect(await titles(page)).toEqual(first);
  await page.getByRole('heading', { name: '发现', exact: true }).hover();
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(5, 10).map(album => album.name), { timeout: 10000 });
  await page.locator(`${active} .cover-link`).first().focus();
  await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'true');
  const pausedTitles = await titles(page);
  await page.waitForTimeout(6500);
  expect(await titles(page)).toEqual(pausedTitles);
  await page.locator(`${active} .album-card`).first().getByRole('button', { name: /更多操作$/ }).click();
  await page.mouse.move(10, 10);
  await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'true');
  await page.waitForTimeout(6500);
  expect(await titles(page)).toEqual(pausedTitles);
  await page.keyboard.press('Escape');
});

test('slow covers retain the complete old group until every incoming image is ready', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(photos[9], async route => { await waiting; await route.continue(); });
  await page.goto('/');
  await page.getByRole('button', { name: '刷新推荐' }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(0, 5).map(album => album.name));
  await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-transitioning', 'false');
  release();
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(5, 10).map(album => album.name));
});

test('reduced motion disables autoplay and manual switching is immediate; model filters reset the group', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '暂停推荐轮换' })).toHaveCount(0);
  await page.waitForTimeout(6500);
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(0, 5).map(album => album.name));
  await page.getByRole('button', { name: '刷新推荐' }).click();
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(5, 10).map(album => album.name));
  await page.locator('.model-filters button').nth(2).click();
  const model = seedFixture().models[1];
  const filtered = seedFixture().albums.filter(album => album.modelIds.includes(model.id));
  await expect(page.locator(`${active} h3`)).toHaveText(filtered.slice(0, 5).map(album => album.name));
  await page.locator('.model-filters button').first().click();
  await expect(page.locator(`${active} h3`)).toHaveText(seedFixture().albums.slice(0, 5).map(album => album.name));
  await page.screenshot({ path: 'test-results/recommendations.png' });
});

for (const count of [0, 1, 2, 5, 10]) {
  test(`${count} albums keep valid empty/single/small-library rotation`, async ({ page }) => {
    const seed = seedFixture();
    seed.albums = seed.albums.slice(0, count);
    await page.addInitScript(seed => localStorage.setItem('jingji.mock.v1', JSON.stringify(seed)), seed);
    await page.goto('/');
    await expect(page.locator(`${active} > .album-card`)).toHaveCount(Math.min(5, count));
    if (count < 2) {
      if (count === 0) await expect(page.getByRole('button', { name: '刷新推荐' })).toHaveCount(0);
      else await expect(page.getByRole('button', { name: '刷新推荐' })).toBeDisabled();
      return;
    }
    await page.getByRole('button', { name: '刷新推荐' }).click();
    const step = count > 5 ? 5 : 1;
    await expect(page.locator(`${active} h3`)).toHaveText(Array.from({ length: Math.min(5, count) }, (_, slot) => seed.albums[(step + slot) % count].name));
    await page.getByRole('button', { name: '刷新推荐' }).click();
    await expect(page.locator(`${active} h3`)).toHaveText(Array.from({ length: Math.min(5, count) }, (_, slot) => seed.albums[(2 * step + slot) % count].name));
    expect(await page.locator('.featured-grid[data-active="false"]').evaluate(element => Number(getComputedStyle(element).opacity))).toBe(0);
    await page.getByRole('button', { name: '刷新推荐' }).click();
    await expect(page.locator(`${active} h3`)).toHaveText(Array.from({ length: Math.min(5, count) }, (_, slot) => seed.albums[(3 * step + slot) % count].name));
  });
}
