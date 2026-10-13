import { expect,test,type Page } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

const portrait = '/tests/fixtures/media/p-1382731.jpg';

async function expectContainedCovers(page: Page, count: number) {
  const grid = page.locator('.featured-grid[data-active="true"]');
  await expect(grid.locator(':scope > .album-card')).toHaveCount(count);
  await expect.poll(() => grid.locator('.cover-link img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalHeight > 0),
  )).toBe(true);
  await expect.poll(() => grid.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const next = document.querySelector('.people-section')!.getBoundingClientRect();
    return [...element.querySelectorAll('.album-card, .cover-link, .cover-link img, .album-overlay')].every(child => {
      const box = child.getBoundingClientRect();
      return box.height > 0 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 && box.bottom < next.top;
    });
  })).toBe(true);
}

for (const count of [1, 2, 5]) {
  test(`${count} portrait covers stay inside the recommendation grid after load and resize`, async ({ page }) => {
    const seed = seedFixture();
    seed.albums = seed.albums.slice(0, count).map(album => ({ ...album, cover: portrait }));
    // Imports have no extracted dimensions; image loading must not size the card.
    seed.media = seed.media.map(item => ({ ...item, width: 0, height: 0 }));
    await page.addInitScript(seed => localStorage.setItem('jingji.mock.v1', JSON.stringify(seed)), seed);
    await page.goto('/');
    for (const width of [1920, 1440, 1024, 800]) {
      await page.setViewportSize({ width, height: 960 });
      await expectContainedCovers(page, count);
      if (width > 800 && count < 3) await expect(page.locator('.featured-grid[data-active="true"]')).toHaveCSS('height', '290px');
    }
    if (count === 5) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('.model-filters button').nth(1).click();
      await expectContainedCovers(page, 1);
      await page.locator('.model-filters button').first().click();
      await expectContainedCovers(page, 5);
    }
  });
}

test('saving the first folder import into an empty library keeps the loaded portrait above the next section', async ({ page }) => {
  const seed = seedFixture();
  Object.assign(seed, { albums: [], media: [], models: [], tags: [], groups: [], recent: [] });
  await page.addInitScript(seed => {
    if (!localStorage.getItem('jingji.mock.v1')) localStorage.setItem('jingji.mock.v1', JSON.stringify(seed));
  }, seed);
  await page.goto('/#/library?create=1');
  await page.getByRole('button', { name: '从文件夹导入', exact: true }).waitFor();
  await page.evaluate(({ portrait }) => {
    (window as any).__TAURI_INTERNALS__ = {
      convertFileSrc: () => portrait,
      invoke: async (command: string) => {
        if (command === 'image_thumbnail') return portrait;
        if (command === 'catalog_import_context') return JSON.parse(localStorage.getItem('jingji.mock.v1')!);
        if (command === 'select_album_folder') return {
          name: 'first-set', path: 'D:/disposable/first-set', skipped: 0,
          manifest: { version: 1, name: '首套竖图写真', number: '001', models: ['首套模特'], tags: [], cover: 'cover.jpg', media: ['cover.jpg'] },
          files: [{ name: 'cover.jpg', path: 'D:/disposable/first-set/cover.jpg', kind: 'image', size: 413930 }],
        };
        throw Error(`Unexpected command: ${command}`);
      },
    };
  }, { portrait });
  await page.getByRole('button', { name: '从文件夹导入', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('首套竖图写真');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发现', exact: true }).click();
  await expectContainedCovers(page, 1);
  await page.reload();
  await expectContainedCovers(page, 1);
});
