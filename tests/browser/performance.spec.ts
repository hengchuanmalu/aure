import { expect,test,type Page } from '@playwright/test';
import { largeLibrary } from "../support/large-library.fixture";

async function syntheticLibrary(page: Page) {
  const db = largeLibrary();
  db.albums[0].mediaIds = db.media.slice(0, 500).map(m => m.id);
  // Explicitly isolate rendering/query tests from localStorage capacity. This is NOT
  // a claim that the legacy repository can persist a 100k library.
  await page.addInitScript(raw => {
    let snapshot = raw;
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    (window as any).__libraryWrites = [];
    Storage.prototype.getItem = function(key) { return key === 'jingji.mock.v1' ? snapshot : get.call(this, key); };
    Storage.prototype.setItem = function(key, value) {
      (window as any).__libraryWrites.push({ key, length: value.length });
      if (key === 'jingji.mock.v1') snapshot = value;
      else set.call(this, key, value);
    };
  }, JSON.stringify(db));
}

test('1000 albums / 100k media: bounded DOM, end reachability, search and resize', async ({ page }) => {
  test.setTimeout(90000);
  await syntheticLibrary(page);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const start = Date.now();
  await page.goto('/#/library');
  await expect(page.locator('.library-results')).toContainText('1000 本');
  await expect(page.locator('.album-card').first()).toBeVisible();
  const firstScreenMs = Date.now() - start;
  expect(await page.locator('.album-card').count()).toBeLessThan(80);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole('link', { name: '打开写真 写真 00999', exact: true })).toBeVisible();
  expect(await page.locator('.album-card').count()).toBeLessThan(80);
  await page.setViewportSize({ width: 1050, height: 800 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole('link', { name: '打开写真 写真 00999', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '搜索写真、模特或标签' }).fill('写真 00999');
  await page.getByRole('combobox', { name: '搜索写真、模特或标签' }).press('Enter');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.getByRole('link', { name: '打开写真 写真 00999', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('写真 00999');
  console.log(JSON.stringify({ firstScreenMs, totalMedia: 100000, renderingOnly: true }));
  expect(errors).toEqual([]);
});

test('500-image album: scroll return and next image write only bounded history', async ({ page }) => {
  await syntheticLibrary(page);
  await page.goto('/#/album/album-0');
  await expect(page.locator('.media-card').first()).toBeVisible();
  expect(await page.locator('.media-card').count()).toBeLessThan(80);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const target = page.getByRole('button', { name: '打开 照片 499.jpg', exact: true });
  await expect(target).toBeVisible();
  const position = await page.evaluate(() => window.scrollY);
  await target.click();
  await expect(page.locator('.media-stage > img')).toHaveAttribute('alt', '照片 499.jpg');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.media-stage > img')).toHaveAttribute('alt', '照片 498.jpg');
  expect(await page.evaluate(() => JSON.stringify(history.state).length)).toBeLessThan(1000);
  await page.keyboard.press('Escape');
  await expect(target).toBeVisible();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - position)).toBeLessThan(60);
  const writes = await page.evaluate(() => (window as any).__libraryWrites as { key: string; length: number }[]);
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.every(w => w.key === 'jingji.mock.v1.recent' && w.length < 20000)).toBe(true);
});

test('100k favorite media remain bounded and can open the last item', async ({ page }) => {
  await syntheticLibrary(page);
  await page.goto('/#/favorites');
  await page.getByRole('button', { name: '照片与视频 · 100000' }).click();
  await expect(page.locator('.media-card').first()).toBeVisible();
  expect(await page.locator('.media-card').count()).toBeLessThan(80);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: '打开 照片 99999.jpg', exact: true }).click();
  await expect(page.locator('.media-stage > img')).toHaveAttribute('alt', '照片 99999.jpg');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.media-stage > img')).toHaveAttribute('alt', '照片 99998.jpg');
  expect(await page.evaluate(() => JSON.stringify(history.state).length)).toBeLessThan(1000);
});

test('local thumbnail failure never loads original into the list', async ({ page }) => {
  const db = largeLibrary(1, 3);
  db.media.forEach((m, i) => { m.sourcePath = `D:/fixture/${i}.jpg`; m.src = `http://asset.localhost/D/fixture/${i}.jpg`; });
  db.albums[0].cover = db.media[0].src;
  await page.addInitScript(raw => {
    localStorage.setItem('jingji.mock.v1', raw);
  }, JSON.stringify(db));
  const originals: string[] = [];
  page.on('request', request => { if (request.url().includes('asset.localhost')) originals.push(request.url()); });
  await page.goto('/#/album/album-0');
  await expect(page.locator('.media-card .photo-fallback')).toHaveCount(3);
  expect(originals).toEqual([]);
});
