import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from '../support/demo.fixture';

async function detailWindowFixture(page: Page, options = { delayed: false, failures: 0 }) {
  const fixture = seedFixture();
  fixture.media = Array.from({ length: 320 }, (_, index) => ({
    ...fixture.media[0], id: `detail-${index}`, name: `素材 ${index}`,
    kind: index % 10 === 0 ? 'video' as const : 'image' as const,
  }));
  const ordered = [...fixture.media.filter(item => item.kind === 'image'), ...fixture.media.filter(item => item.kind === 'video')];
  fixture.albums = [{ ...fixture.albums[0], mediaIds: ordered.map(item => item.id) }];
  await page.addInitScript(({ fixture, options }) => {
    const w = window as any;
    const album = fixture.albums[0];
    const sequence = [...fixture.media.filter(item => item.kind === 'image'), ...fixture.media.filter(item => item.kind === 'video')];
    let failures = options.failures;
    w.__detailWrites = [];
    w.__detailEntityReads = 0;
    w.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any = {}) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'image_thumbnail') return fixture.media[0].src;
      if (command === 'catalog_entity') {
        w.__detailEntityReads++;
        if (failures-- > 0) throw Error('读取暂时失败');
        if (options.delayed) await new Promise<void>(resolve => { w.__releaseDetailEntity = resolve; });
        return structuredClone(album);
      }
      if (command === 'catalog_candidates') {
        const items = args.kind === 'models' ? fixture.models : sequence.filter(item => item.kind === 'image');
        return { items: structuredClone(items.slice(args.page * 48, (args.page + 1) * 48)), total: items.length };
      }
      if (command === 'catalog_operation') {
        w.__detailWrites.push(structuredClone(args.op));
        Object.assign(album, args.op.album);
        return;
      }
      if (command === 'catalog_view') {
        const q = args.query;
        const filtered = sequence.filter(item => !q.kind || q.kind === 'all' || item.kind === q.kind);
        const media = q.route === 'viewer' ? sequence.filter(item => item.id === q.id) : filtered.slice(q.page * 96, (q.page + 1) * 96);
        const position = filtered.findIndex(item => item.id === q.id);
        return {
          db: { ...structuredClone(fixture), albums: [{ ...structuredClone(album), mediaIds: [],
            _summary: { images: 288, videos: 32, bytes: 0, tags: [], searchText: '', previews: [] } }], media },
          page: q.page, limit: 96, total: filtered.length, mediaTotal: filtered.length,
          albumTotal: 1, modelTotal: fixture.models.length, mediaCount: sequence.length,
          visibleMediaIds: media.map(item => item.id), firstMediaId: sequence[0].id,
          ...(q.route === 'viewer' ? { viewer: { index: position, total: filtered.length,
            previous: filtered[position - 1]?.id, next: filtered[position + 1]?.id } } : {}),
        };
      }
      if (command.startsWith('plugin:window|')) return false;
      throw Error(`Unexpected detail-window call: ${command}`);
    } };
  }, { fixture, options });
  return fixture;
}

test('album browse starts at the first photo without a complete relationship array', async ({ page }) => {
  const fixture = await detailWindowFixture(page);
  await page.goto(`/#/album/${fixture.albums[0].id}?type=video`);
  await expect(page.locator('.media-card').first()).toHaveAttribute('data-media-id', 'detail-0');
  await page.getByRole('button', { name: '浏览写真', exact: true }).click();
  await expect(page.locator('.media-stage > img')).toHaveAttribute('alt', '素材 1');
  await expect(page.locator('.viewer-position')).toHaveText('1 / 320');
});

test('album editing waits for complete associations and preserves items outside the display window', async ({ page }) => {
  const fixture = await detailWindowFixture(page, { delayed: true, failures: 0 });
  await page.goto(`/#/album/${fixture.albums[0].id}?edit=1`);
  await expect(page.getByRole('status')).toContainText('正在读取写真集');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseDetailEntity)).toBe('function');
  await page.evaluate(() => (window as any).__releaseDetailEntity());
  await page.getByLabel('写真集名称', { exact: true }).fill('完整关联仍保留');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__detailWrites[0].album);
  expect(saved.name).toBe('完整关联仍保留');
  expect(saved.mediaIds).toEqual(fixture.albums[0].mediaIds);
  expect(saved.modelIds).toEqual(fixture.albums[0].modelIds);
});

test('a failed complete album read cannot submit an empty relationship draft and can be retried', async ({ page }) => {
  const fixture = await detailWindowFixture(page, { delayed: false, failures: 1 });
  await page.goto(`/#/album/${fixture.albums[0].id}?edit=1`);
  await expect(page.getByRole('alert')).toContainText('无法读取写真集');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue(fixture.albums[0].name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__detailWrites[0].album);
  expect(saved.mediaIds).toEqual(fixture.albums[0].mediaIds);
  expect(await page.evaluate(() => (window as any).__detailEntityReads)).toBe(2);
});
