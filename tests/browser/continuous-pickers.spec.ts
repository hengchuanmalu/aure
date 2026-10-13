import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from '../support/demo.fixture';

async function reachEnd(page: Page, scroller: string, items: string, count: number) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await page.locator(items).count() === count) break;
    await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(150);
  }
  await expect(page.locator(items)).toHaveCount(count);
}

test('model album choices scroll through all local windows and save first and last selections', async ({ page }) => {
  const db = seedFixture();
  db.albums = Array.from({ length: 101 }, (_, index) => ({ ...db.albums[0], id: `choice-${index}`, name: `写真 ${index}`, modelIds: [] }));
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), db);
  await page.goto('/#/models');
  await page.locator('.topbar').getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByLabel('模特名称', { exact: true }).fill('连续选择测试');
  await page.getByRole('button', { name: '关联写真集', exact: true }).click();
  await expect(page.getByRole('button', { name: /上一页|下一页|跳至/ })).toHaveCount(0);
  const first = page.getByRole('checkbox', { name: '写真 0', exact: true });
  await first.check();
  const save = page.getByRole('button', { name: '保存', exact: true });
  const cancel = page.getByRole('button', { name: '取消', exact: true });
  const saveBox = await save.boundingBox();
  const cancelBox = await cancel.boundingBox();
  expect(Math.abs(saveBox!.width - cancelBox!.width)).toBeLessThanOrEqual(2);
  expect(saveBox!.height).toBe(32);
  await reachEnd(page, '.motion-panel-resizing', '.album-choices [role=checkbox]', 101);
  await page.getByRole('checkbox', { name: '写真 100', exact: true }).check();
  await expect(first).toBeChecked();
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  const id = result.models.find((model: { name: string }) => model.name === '连续选择测试').id;
  expect(result.albums.filter((album: { modelIds: string[] }) => album.modelIds.includes(id)).map((album: { id: string }) => album.id)).toEqual(['choice-0', 'choice-100']);
});

test('album model choices continue inside their nested scroll surface', async ({ page }) => {
  const db = seedFixture();
  db.models = Array.from({ length: 101 }, (_, index) => ({ ...db.models[0], id: `person-${index}`, name: `人物 ${index}` }));
  db.albums[0].modelIds = [];
  await page.addInitScript(full => localStorage.setItem('jingji.mock.v1', JSON.stringify(full)), db);
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const first = page.getByRole('button', { name: '关联模特 人物 0', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await reachEnd(page, '.album-model-scroll', '.album-model-option:not(.album-add-model)', 101);
  await page.getByRole('button', { name: '关联模特 人物 100', exact: true }).click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].modelIds)).toEqual(['person-0', 'person-100']);
});

async function nativeFixture(page: Page) {
  const db = seedFixture();
  db.albums = Array.from({ length: 101 }, (_, index) => ({ ...db.albums[0], id: `choice-${index}`, name: `写真 ${index}`, favorite: true, modelIds: [] }));
  db.media = Array.from({ length: 205 }, (_, index) => ({ ...db.media[0], id: `media-${index}`, favorite: true }));
  await page.addInitScript(full => {
    const w = window as any;
    w.__candidateReads = [];
    w.__favoriteReads = [];
    w.__failNext = true;
    w.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'image_thumbnail') return '/tests/fixtures/media/p-1239291.jpg';
      if (command === 'catalog_candidates') {
        w.__candidateReads.push(args.page);
        if (args.page === 1 && w.__failNext) { w.__failNext = false; throw Error('后续读取测试失败'); }
        return { items: full.albums.slice(args.page * 48, (args.page + 1) * 48), total: full.albums.length };
      }
      if (command === 'catalog_view') {
        const q = args.query;
        if (q.route === 'favorites') w.__favoriteReads.push(q.page);
        const albums = q.route === 'favorites' ? full.albums.slice(q.page * 96, (q.page + 1) * 96) : [];
        const media = q.route === 'favorites' ? full.media.slice(q.page * 96, (q.page + 1) * 96) : [];
        return { db: { ...full, albums, media }, page: q.page, limit: 96, total: full.albums.length, mediaTotal: full.media.length,
          albumTotal: full.albums.length, mediaCount: full.media.length, modelTotal: full.models.length, visibleMediaIds: media.map(item => item.id) };
      }
      throw Error(`Unexpected native call: ${command}`);
    } };
  }, db);
}

test('remote picker retries a failed continuation and retains checked rows', async ({ page }) => {
  await nativeFixture(page);
  await page.goto('/#/models');
  await page.locator('.topbar').getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByRole('button', { name: '关联写真集', exact: true }).click();
  const first = page.getByRole('checkbox', { name: '写真 0', exact: true });
  await first.check();
  await page.locator('.motion-panel-resizing').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.dialog-content').getByRole('alert')).toContainText('后续读取测试失败');
  await expect(first).toBeChecked();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.album-choices [role=checkbox]')).toHaveCount(96);
  await reachEnd(page, '.motion-panel-resizing', '.album-choices [role=checkbox]', 101);
  await page.getByRole('checkbox', { name: '写真 100', exact: true }).check();
  await expect(first).toBeChecked();
  expect(await page.evaluate(() => (window as any).__candidateReads)).toEqual([0, 1, 1, 2]);
  await expect(page.locator('.picker-pages, input[type=number]')).toHaveCount(0);
});

test('favorites continuously reach all media when their total exceeds the album total', async ({ page }) => {
  await nativeFixture(page);
  await page.goto('/#/favorites?page=9');
  await page.getByRole('button', { name: '照片与视频 · 205', exact: true }).click();
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await page.locator('.virtual-grid').getAttribute('data-total-items') === '205') break;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect(page.locator('.virtual-grid')).toHaveAttribute('data-total-items', '205');
  await expect(page.getByRole('button', { name: /上一页|下一页|跳至/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__favoriteReads)).toEqual([0, 1, 2]);
  await page.getByRole('button', { name: '写真集 · 101', exact: true }).click();
  await expect(page.locator('.virtual-grid')).toHaveAttribute('data-total-items', '101');
});
