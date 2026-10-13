import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

for (const [name, ids, photos, videos] of [
  ['photos only', ['p0', 'p1'], true, false],
  ['videos only', ['v0', 'v1'], false, true],
  ['mixed', ['p0', 'v0'], true, true],
  ['empty', [], false, false],
] as const) {
  test(`album content filters follow ${name}`, async ({ page }) => {
    const db = seedFixture();
    db.albums[0].mediaIds = [...ids];
    await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', snapshot), JSON.stringify(db));
    await page.goto('/#/album/a0');
    const tabs = page.locator('.album-content-toolbar .tabs');
    await expect(tabs.getByRole('button', { name: '全部内容', exact: true })).toHaveCount(photos && videos ? 1 : 0);
    await expect(tabs.getByRole('button', { name: '照片', exact: true })).toHaveCount(photos ? 1 : 0);
    await expect(tabs.getByRole('button', { name: '视频', exact: true })).toHaveCount(videos ? 1 : 0);
    if (photos && videos) {
      await tabs.getByRole('button', { name: '照片', exact: true }).click();
      await expect(tabs.getByRole('button', { name: '视频', exact: true })).toBeVisible();
      await tabs.getByRole('button', { name: '视频', exact: true }).click();
      await expect(tabs.getByRole('button', { name: '照片', exact: true })).toBeVisible();
    } else {
      if (ids.length) await expect(tabs.getByRole('button', { name: photos ? '照片' : '视频', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.goto(`/#/album/a0?type=${photos ? 'video' : 'image'}&page=2&keep=1`);
      await expect(page).toHaveURL(/#\/album\/a0\?keep=1$/);
      if (ids.length) {
        await expect(tabs.getByRole('button', { name: photos ? '照片' : '视频', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.media-card')).toHaveCount(ids.length);
      }
    }
  });
}

test('desktop filters use album totals even when the current page has one media kind', async ({ page }) => {
  const db = seedFixture();
  db.albums[0].mediaIds = ['p0', 'v0'];
  db.albums[0]._summary = { images: 200, videos: 1, bytes: 0, tags: [], searchText: '', previews: [] };
  db.albums = [db.albums[0]];
  await page.addInitScript(snapshot => {
    const full = JSON.parse(snapshot);
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'image_thumbnail') return '/tests/fixtures/media/p-1239291.jpg';
      if (command === 'catalog_view') {
        const video = args.query.kind === 'video';
        const media = full.media.filter((item: any) => item.id === (video ? 'v0' : 'p0'));
        return { db: { ...full, media }, visibleMediaIds: media.map((item: any) => item.id), page: 0, limit: 96, total: video ? 1 : 200, mediaTotal: video ? 1 : 200, albumTotal: 1, modelTotal: 0, mediaCount: 201 };
      }
      throw Error(`Unexpected native call: ${command}`);
    } };
  }, JSON.stringify(db));
  await page.goto('/#/album/a0?type=image');
  const tabs = page.locator('.album-content-toolbar .tabs');
  await expect(tabs.getByRole('button', { name: '全部内容', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name: '视频', exact: true })).toBeVisible();
  await tabs.getByRole('button', { name: '视频', exact: true }).click();
  await expect(tabs.getByRole('button', { name: '照片', exact: true })).toBeVisible();
  await expect(page.locator('[data-media-id="v0"]')).toBeVisible();
});
