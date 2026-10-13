import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from '../support/demo.fixture';

async function desktopFixture(page: Page, count = 12) {
  const db = seedFixture();
  if (count !== 12) db.albums = Array.from({ length: count }, (_, i) => ({ ...db.albums[i % 12], id: `set-${i}`, name: `写真 ${i}`, favorite: true }));
  db.settings.reducedMotion = true;
  await page.addInitScript(full => {
    const w = window as any;
    w.__catalog = full; w.__reads = []; w.__writes = 0; w.__fail = false;
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string, args: any) => {
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_recent') return full.recent;
        if (command === 'plugin:window|is_fullscreen') return false;
        if (command === 'plugin:window|set_fullscreen') return;
        if (command === 'catalog_patch' || command === 'catalog_operation') { w.__writes++; return; }
        if (command === 'catalog_entity') return full[args.kind as keyof typeof full].find((item: any) => item.id === args.id);
        if (command === 'catalog_model_albums') return full.albums.filter(a => a.modelIds.includes(args.id)).map(a => a.id);
        if (command === 'catalog_candidates') {
          await new Promise(resolve => setTimeout(resolve, 180));
          const q = args.query || {};
          let items: any[] = full[args.kind as keyof typeof full] as any[];
          if (q.model) items = items.filter(a => a.modelIds.includes(q.model));
          if (q.album) items = items.filter(m => full.albums.find(a => a.id === q.album)?.mediaIds.includes(m.id));
          if (q.favorite) items = items.filter(m => m.favorite);
          if (q.kind) items = items.filter(m => m.kind === q.kind);
          return { items: structuredClone(items.slice(args.page * 48, (args.page + 1) * 48)), total: items.length };
        }
        if (command !== 'catalog_view') throw Error(command);
        const q = args.query; w.__reads.push(q);
        const fail = w.__fail;
        await new Promise(resolve => setTimeout(resolve, w.__race && q.model === 'm0' ? 400 : w.__race && q.model === 'm1' ? 40 : 180));
        if (fail) throw Error('模拟读取失败');
        const db = structuredClone(full);
        let albums = db.albums;
        if (q.model) albums = albums.filter(a => a.modelIds.includes(q.model));
        if (q.tags.length) albums = albums.filter(a => q.tags.every((tag: string) => a.tags.includes(tag)));
        if (q.sort === 'created') albums = [...albums.slice(1), albums[0]];
        let media = db.media;
        if (q.route === 'album') { albums = albums.filter(a => a.id === q.id); media = media.filter(m => albums[0].mediaIds.includes(m.id) && (q.kind === 'all' || m.kind === q.kind)); }
        if (q.route === 'favorites') { albums = albums.filter(a => a.favorite); media = media.filter(m => m.favorite); }
        const total = albums.length;
        db.albums = albums.slice(q.page * 96, (q.page + 1) * 96);
        const seq = q.owner === 'favorites' ? full.media.filter(m => m.favorite) : full.media.filter(m => full.albums.find(a => a.id === q.owner)?.mediaIds.includes(m.id));
        const index = seq.findIndex(m => m.id === q.id);
        return { db, page: q.page, limit: 96, total: q.route === 'album' ? media.length : total, albumTotal: full.albums.length,
          modelTotal: full.models.length, mediaTotal: media.length, mediaCount: full.media.length, visibleMediaIds: media.map(m => m.id),
          ...(q.route === 'viewer' ? { viewer: { index, total: seq.length, previous: seq[index - 1]?.id, next: seq[index + 1]?.id } } : {}) };
      } };
  }, db);
}

for (const [route, selector, trigger] of [
  ['/library', '.library-page', '.model-filters .entity-chip:nth-child(2)'],
  ['/', '.discovery', '.model-filters .entity-chip:nth-child(2)'],
  ['/tags', '.tag-browse-page', '.tag-browse-chip'],
  ['/album/a0', '.album-content-toolbar', '.album-content-toolbar .tabs button:nth-child(2)'],
] as const) test(`${route} keeps its page and shell while replacing a filtered snapshot`, async ({ page }) => {
  await desktopFixture(page); await page.goto('/#' + route);
  await page.locator(selector).waitFor();
  await page.evaluate(selector => { const w = window as any; w.__heldPage = document.querySelector(selector); w.__heldShell = document.querySelector('.topbar'); }, selector);
  await page.locator(trigger).first().click();
  expect(await page.evaluate(() => (window as any).__heldPage.isConnected)).toBe(true);
  await expect(page.locator('#root > .loading')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(selector => (window as any).__heldPage === document.querySelector(selector), selector)).toBe(true);
  expect(await page.evaluate(() => (window as any).__heldShell === document.querySelector('.topbar'))).toBe(true);
});

test('sorting moves a card between rows without remounting its decoded image; dialogs retain the grid', async ({ page }) => {
  await desktopFixture(page, 60); await page.goto('/#/library');
  await page.locator('[data-grid-id="set-8"] img').first().waitFor();
  await page.evaluate(() => { const w = window as any; w.__heldGrid = document.querySelector('.album-grid'); w.__heldImage = document.querySelector('[data-grid-id="set-8"] img'); });
  await page.evaluate(() => { location.hash = '/library?sort=created'; });
  await expect(page.locator('[data-grid-id="set-8"]')).toHaveAttribute('data-index', '1');
  expect(await page.evaluate(() => (window as any).__heldImage === document.querySelector('[data-grid-id="set-8"] img'))).toBe(true);
  await page.locator('.topbar').getByRole('button', { name: '添加写真', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__heldGrid === document.querySelector('.album-grid'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__heldImage.isConnected)).toBe(true);
});

test('the 49th item retains visible cards while the grid remains bounded', async ({ page }) => {
  await desktopFixture(page, 48); await page.goto('/#/library');
  await page.locator('.album-card').first().waitFor();
  await page.evaluate(() => { const w = window as any; w.__heldGrid = document.querySelector('.album-grid'); w.__heldCard = document.querySelector('.album-card'); w.__catalog.albums.push({ ...w.__catalog.albums[0], id: '49th' }); window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('.album-grid')).toHaveAttribute('data-total-items', '49');
  expect(await page.evaluate(() => (window as any).__heldGrid === document.querySelector('.album-grid'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__heldCard === document.querySelector('.album-card'))).toBe(true);
  expect(await page.locator('.album-card').count()).toBeLessThan(49);
});

test('rapid queries ignore late results and pending snapshots cannot be written', async ({ page }) => {
  await desktopFixture(page); await page.goto('/#/library'); await page.locator('.album-card').first().waitFor();
  await page.evaluate(() => { (window as any).__race = true; location.hash = '/library?model=m0'; });
  await page.waitForTimeout(60);
  await page.locator('.album-card').first().hover();
  await page.locator('.album-card').first().getByRole('button', { name: /^收藏|^取消收藏/ }).click();
  expect(await page.evaluate(() => (window as any).__writes)).toBe(0);
  await page.evaluate(() => { location.hash = '/library?model=m1'; });
  await expect(page.locator('.album-card h3')).toHaveText(['城市漫游', '风与自由']);
  await page.waitForTimeout(450);
  await expect(page.locator('.album-card h3')).toHaveText(['城市漫游', '风与自由']);
});

test('query errors keep the existing grid and retry replaces it', async ({ page }) => {
  await desktopFixture(page); await page.goto('/#/library'); await page.locator('.album-grid').waitFor();
  await page.evaluate(() => { const w = window as any; w.__heldGrid = document.querySelector('.album-grid'); w.__fail = true; location.hash = '/library?model=m0'; });
  await expect(page.getByRole('alert')).toContainText('模拟读取失败');
  expect(await page.evaluate(() => (window as any).__heldGrid.isConnected)).toBe(true);
  await page.evaluate(() => { (window as any).__fail = false; });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.album-card h3')).toHaveText(['光落在肩上', '日常的诗意']);
  expect(await page.evaluate(() => (window as any).__heldGrid === document.querySelector('.album-grid'))).toBe(true);
});

test('favorite media viewer retains the source grid and exits without rereading favorites', async ({ page }) => {
  await desktopFixture(page); await page.goto('/#/favorites?tab=media'); await page.locator('.media-card').waitFor();
  await page.evaluate(() => { const w = window as any; w.__heldGrid = document.querySelector('.media-grid'); w.__favoriteReads = w.__reads.filter((q: any) => q.route === 'favorites').length; });
  await page.locator('.media-open').first().click(); await expect(page.locator('.viewer')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__heldGrid.isConnected)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.viewer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__heldGrid === document.querySelector('.media-grid'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__reads.filter((q: any) => q.route === 'favorites').length === (window as any).__favoriteReads)).toBe(true);
});

for (const [tab, stage, group] of [['模特头像', '.avatar-crop-stage', '头像图片来源'], ['背景图片', '.background-crop-stage', '背景图片来源']] as const)
  test(`${tab} source changes preserve the picker and preview while waiting for candidates`, async ({ page }) => {
    await desktopFixture(page); await page.goto('/#/models/m0');
    await page.locator('.topbar').getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.getByRole('button', { name: tab, exact: true }).click(); await page.locator('.avatar-photo').first().waitFor();
    await page.evaluate(stage => { const w = window as any; w.__heldPicker = document.querySelector('.avatar-photo-scroll'); w.__heldPreview = document.querySelector(stage); }, stage);
    const sources = page.getByRole('group', { name: group, exact: true });
    await sources.getByRole('button').nth(1).click();
    await expect(page.locator('.avatar-photo-scroll')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.avatar-photo').first()).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__heldPicker.isConnected)).toBe(true);
    await expect(page.locator('.avatar-photo-scroll')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => (window as any).__heldPicker === document.querySelector('.avatar-photo-scroll'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__heldPreview.isConnected)).toBe(true);
  });
