import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

async function desktopFixture(page: import('@playwright/test').Page) {
  const db = seedFixture();
  db.media = Array.from({ length: 215 }, (_, i) => ({ ...db.media[0], id: `content-${i}`, name: `照片 ${i}`, kind: i >= 213 ? 'video' as const : 'image' as const }));
  db.albums = Array.from({ length: 205 }, (_, i) => ({ ...db.albums[0], id: `set-${i}`, name: `写真 ${i}`, modelIds: ['m0'], mediaIds: db.media.map(m => m.id),
    _summary: { images: 213, videos: 2, bytes: 0, tags: [], searchText: '', previews: [] } }));
  await page.addInitScript(full => {
    const w = window as any;
    w.__queries = [];
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command: string, args: any) => {
      if (command === 'plugin:window|is_fullscreen') return false;
      if (command === 'plugin:window|set_fullscreen') return;
      if (command === 'catalog_initialize') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'image_thumbnail') return '/tests/fixtures/media/p-1239291.jpg';
      if (command === 'catalog_entity') return full.albums.find(a => a.id === args.id) || null;
      if (command === 'catalog_view') {
        const q = args.query; w.__queries.push(q);
        const start = q.page * 96;
        const albums = q.route === 'album' || q.route === 'viewer' ? full.albums.filter(a => a.id === (q.owner || q.id)) : full.albums.slice(start, start + 96);
        const media = q.route === 'album' ? full.media.filter(m => q.kind === 'all' || m.kind === q.kind).slice(start, start + 96)
          : q.route === 'viewer' ? full.media.filter(m => m.id === q.id) : [];
        const position = full.media.findIndex(m => m.id === q.id);
        return { db: { ...full, albums, media }, page: q.page, limit: 96, total: q.route === 'album' ? 215 : 205,
          mediaTotal: q.route === 'album' ? 215 : 0, albumTotal: 205, modelTotal: 6, mediaCount: 215,
          visibleMediaIds: media.map(m => m.id), ...(q.route === 'viewer' ? { viewer: { index: position, total: 215, previous: full.media[position - 1]?.id, next: full.media[position + 1]?.id } } : {}) };
      }
      throw Error(`Unexpected native call: ${command}`);
    } };
  }, db);
}

async function scrollToAll(page: import('@playwright/test').Page, selector: string, total: number) {
  for (let i = 0; i < 8; i++) {
    if (Number(await page.locator(selector).getAttribute('data-total-items')) === total) break;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
  }
  await expect(page.locator(selector)).toHaveAttribute('data-total-items', String(total));
}

test('native library and model albums continuously reach the final window without pagination', async ({ page }) => {
  await desktopFixture(page);
  await page.goto('/#/library?page=9');
  await scrollToAll(page, '.virtual-grid', 205);
  await expect(page.getByRole('button', { name: /上一页|下一页|跳至/ })).toHaveCount(0);
  await page.locator('.album-card').last().getByRole('link').first().click();
  await page.getByRole('button', { name: '返回写真库' }).click();
  await expect(page.locator('.virtual-grid')).toHaveAttribute('data-total-items', '205');
  const libraryQueries = await page.evaluate(() => (window as any).__queries.filter((q: any) => q.route === 'library'));
  expect(libraryQueries.map((q: any) => q.page)).toEqual([0, 1, 2]);
  await page.evaluate(() => { location.hash = '/models/m0'; });
  await scrollToAll(page, '.virtual-grid', 205);
  await expect(page.getByRole('link', { name: '查看全部' })).toHaveCount(0);
});

test('all native media remain mounted beneath the viewer and return without another album read', async ({ page }) => {
  await desktopFixture(page);
  await page.goto('/#/album/set-0');
  await scrollToAll(page, '.media-layout', 215);
  await expect(page.locator('[data-media-id="content-214"]')).toBeVisible();
  await page.locator('[data-media-id="content-212"] .media-open').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const w = window as any; w.__retainedGrid = document.querySelector('.media-layout');
    w.__returnY = scrollY; w.__albumReads = w.__queries.filter((q: any) => q.route === 'album').length;
  });
  // Return from an image after scrolling deep into the album.
  await page.locator('[data-media-id="content-212"] .media-open').click();
  await expect(page.locator('.viewer')).toBeVisible();
  const y = await page.evaluate(() => scrollY);
  await page.locator('.media-stage').hover();
  await page.mouse.wheel(0, 100);
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  const state = await page.evaluate(() => {
    const w = window as any; return { sameNode: w.__retainedGrid === document.querySelector('.media-layout'), connected: w.__retainedGrid.isConnected,
      sameScroll: Math.abs(scrollY - w.__returnY) < 1, reads: w.__queries.filter((q: any) => q.route === 'album').length, previousReads: w.__albumReads };
  });
  expect(state.sameNode).toBe(true);
  expect(state.connected).toBe(true);
  expect(state.sameScroll).toBe(true);
  expect(state.reads).toBe(state.previousReads);
  await expect(page.locator('.loading')).toHaveCount(0);
});

test('automatic continuation resumes after returning from a viewer before the last window', async ({ page }) => {
  await desktopFixture(page);
  await page.goto('/#/album/set-0');
  await page.locator('.media-card').first().getByRole('button', { name: /^打开/ }).first().click();
  await expect(page.locator('.viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await scrollToAll(page, '.media-layout', 215);
});

test('cover and avatar open original images; cover selection uses a continuous filmstrip', async ({ page }) => {
  const db = seedFixture();
  db.media = Array.from({ length: 70 }, (_, i) => ({ ...db.media[0], id: `photo-${i}`, name: `图片 ${i}` }));
  db.albums[0].mediaIds = db.media.map(m => m.id);
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), db);
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '查看封面大图' }).click();
  await expect(page.locator('.image-lightbox img')).toHaveAttribute('src', db.albums[0].cover);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await picker.getByRole('group', { name: '封面照片', exact: true }).press('End');
  await picker.getByRole('button', { name: '封面 素材 70', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].coverMediaId)).toBe('photo-69');
  await page.goto('/#/models/m0');
  await page.getByRole('button', { name: '查看头像大图' }).click();
  await expect(page.locator('.image-lightbox img')).toHaveAttribute('src', db.models[0].avatar);
});

test('menu stays still and image hover does not reflow the grid', async ({ page }) => {
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), seedFixture());
  await page.goto('/#/library');
  const button = page.getByRole('button', { name: '光落在肩上 更多操作' });
  await page.locator('.album-card').first().hover();
  const before = await button.boundingBox();
  await button.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await expect(page.getByRole('menu')).toBeVisible();
  const after = await button.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0); expect(after!.y).toBeCloseTo(before!.y, 0);
  await page.keyboard.press('Escape');
  await page.goto('/#/album/a0');
  const card = page.locator('.media-card').first();
  const rect = await card.evaluate(el => ({ top: (el as HTMLElement).offsetTop, width: (el as HTMLElement).offsetWidth }));
  await card.hover();
  expect(await card.evaluate(el => ({ top: (el as HTMLElement).offsetTop, width: (el as HTMLElement).offsetWidth }))).toEqual(rect);
});

test('letter wheel follows available initials and settings scroll only the right pane', async ({ page }) => {
  const db = seedFixture();
  db.models = ['Alice', 'Bella', 'Zoe'].map((name, i) => ({ ...db.models[0], id: `m${i}`, name }));
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), db);
  await page.goto('/#/models');
  await page.locator('.model-index-zone').hover();
  await page.getByRole('button', { name: '筛选 A 开头的模特' }).click();
  await page.mouse.wheel(0, 100);
  await expect(page.getByRole('button', { name: '筛选 B 开头的模特' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(160);
  await page.mouse.wheel(0, -100);
  await expect(page.getByRole('button', { name: '筛选 A 开头的模特' })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '高级设置', exact: true }).click();
  const navBefore = await page.locator('.settings-nav').boundingBox();
  await page.locator('.settings-content').hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.locator('.settings-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.settings-nav').boundingBox()).toEqual(navBefore);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: '关于', exact: true }).click();
  await expect(page.locator('.settings-content')).toContainText('当前版本号');
  await expect(page.locator('.settings-content')).toContainText('版本时间');
  await expect(page.locator('.settings-content')).toContainText('GitHub');
  await expect(page.locator('.settings-content')).toContainText('即将上线');
  await expect(page.getByText('运行环境', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'verification/continuous-settings.png' });
});
