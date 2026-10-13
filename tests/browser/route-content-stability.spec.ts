import { expect, test } from '../support/browser.fixture';

test('library and tag browsing retain their grid, cards and decoded images across routes', async ({ page }) => {
  await page.goto('/#/library');
  await expect(page.locator('.album-grid .fan-front .photo-frame').first()).toHaveAttribute('data-photo-state', 'ready');
  for (const path of ['/tags', '/library', '/tags', '/library']) {
    const result = await page.evaluate(async path => {
      const grid = document.querySelector('.album-grid');
      const card = grid?.querySelector('[data-grid-id]');
      const photo = card?.querySelector('.fan-front .photo-frame');
      let removed = false, lostReady = false;
      const observer = new MutationObserver(() => {
        removed ||= !grid?.isConnected || !card?.isConnected;
        lostReady ||= photo?.getAttribute('data-photo-state') !== 'ready';
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-photo-state'] });
      location.hash = path;
      await new Promise(resolve => setTimeout(resolve, 350));
      observer.disconnect();
      return { removed, lostReady, sameGrid: grid === document.querySelector('.album-grid') };
    }, path);
    expect(result).toEqual({ removed: false, lostReady: false, sameGrid: true });
    await expect(page.locator('h1')).toHaveText(path === '/tags' ? '标签' : '写真库');
  }
});

test('favorites and recent browsing retain their shared list container', async ({ page }) => {
  await page.goto('/#/favorites');
  await expect(page.locator('.album-grid')).toBeVisible();
  const result = await page.evaluate(async () => {
    const grid = document.querySelector('.album-grid');
    location.hash = '/recent';
    await new Promise(resolve => setTimeout(resolve, 200));
    return { sameGrid: grid === document.querySelector('.album-grid'), connected: grid?.isConnected };
  });
  expect(result).toEqual({ sameGrid: true, connected: true });
  await expect(page.locator('h1')).toHaveText('最近浏览');
});
