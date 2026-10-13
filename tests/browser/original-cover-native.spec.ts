import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

test('discovery adaptive cache revalidates changed and revoked images and bounds resolution', async ({ page }) => {
  const snapshot = seedFixture();
  snapshot.media[0].src = 'http://jingji.localhost/media/p0';
  snapshot.albums[0].cover = snapshot.media[0].src;
  await page.addInitScript(snapshot => {
    const win = window as any;
    win.__coverVersion = 'one'; win.__denyCover = false; win.__thumbnailCalls = [];
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    win.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { source?: string; edge?: number }) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'image_thumbnail') {
        win.__thumbnailCalls.push(args);
        if (win.__denyCover && args.source === 'media:p0') throw '图片访问权限已失效';
        return `/tests/fixtures/media/p-1239291.jpg?v=${win.__coverVersion}&edge=${args.edge}`;
      }
      if (command === 'original_cover_revision') {
        if (win.__denyCover) throw '图片访问权限已失效';
        return win.__coverVersion;
      }
      if (command === 'catalog_view') return {
        db: structuredClone(snapshot), page: 0, limit: 96, total: snapshot.albums.length,
        albumTotal: snapshot.albums.length, modelTotal: snapshot.models.length, mediaTotal: snapshot.media.length, mediaCount: snapshot.media.length,
        coverRevisions: win.__denyCover ? {} : { 'http://jingji.localhost/media/p0': win.__coverVersion },
      };
      throw Error(`Unexpected native command: ${command}`);
    } };
  }, snapshot);
  const originals: string[] = [];
  page.on('request', request => { if (request.url().startsWith('http://jingji.localhost/media/')) originals.push(request.url()); });
  await page.setViewportSize({ width: 2800, height: 1200 });
  await page.goto('/');
  const card = page.locator('.featured-grid .album-card').first();
  const image = card.locator('.cover-link img');
  await expect(image).toHaveAttribute('src', /v=one&edge=3072$/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => { (window as any).__originalNode = document.querySelector('.featured-grid .cover-link img'); });
  const nav = page.getByRole('navigation', { name: '主导航' });
  await page.evaluate(() => { (window as any).__coverVersion = 'two'; window.dispatchEvent(new Event('focus')); });
  await expect(image).toHaveAttribute('src', /v=two&edge=3072$/);
  expect(await image.evaluate(img => img === (window as any).__originalNode)).toBe(false);
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await page.evaluate(() => { (window as any).__denyCover = true; });
  await nav.getByRole('link', { name: '发现', exact: true }).click();
  await expect(card.locator('.photo-fallback')).toBeVisible();
  await expect(image).toHaveCount(0);
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await page.evaluate(() => { (window as any).__denyCover = false; (window as any).__coverVersion = 'three'; });
  await nav.getByRole('link', { name: '发现', exact: true }).click();
  await expect(image).toHaveAttribute('src', /v=three&edge=3072$/);
  const edges = await page.evaluate(() => (window as any).__thumbnailCalls.map((call: { edge: number }) => call.edge));
  expect(edges).toContain(3072);
  expect(edges.every((edge: number) => [512, 1024, 2048, 3072].includes(edge))).toBe(true);
  expect(originals).toEqual([]);
});
