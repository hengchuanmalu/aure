import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

test('desktop thumbnail clicks retain decoded nodes and candidate pages while metadata loads', async ({ page }) => {
  const db = seedFixture();
  db.media = Array.from({ length: 75 }, (_, index) => ({ ...db.media[index % 12], id: `photo-${index}`, name: `照片 ${index}`, kind: 'image' as const }));
  db.albums = [{ ...db.albums[0], mediaIds: db.media.map(item => item.id) }];
  await page.addInitScript(full => {
    const win = window as any;
    win.__candidateReads = 0;
    win.__thumbnailReads = 0;
    win.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'plugin:window|is_fullscreen') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'image_thumbnail') {
        win.__thumbnailReads++;
        return '/tests/fixtures/media/p-1239291.jpg';
      }
      if (command === 'catalog_candidates') {
        win.__candidateReads++;
        const items = full.media.slice(args.page * 48, (args.page + 1) * 48);
        return { items, total: full.media.length };
      }
      if (command === 'catalog_view') {
        await new Promise(resolve => setTimeout(resolve, 350));
        const index = full.media.findIndex(item => item.id === args.query.id);
        return {
          db: { ...structuredClone(full), media: index >= 0 ? [full.media[index]] : [] },
          page: 0, limit: 96, total: full.media.length, mediaTotal: full.media.length,
          albumTotal: 1, modelTotal: full.models.length, mediaCount: full.media.length,
          viewer: { index, total: full.media.length, previous: full.media[index - 1]?.id, next: full.media[index + 1]?.id },
        };
      }
      throw Error(`Unexpected command ${command}`);
    } };
  }, db);
  await page.goto('/#/viewer/a0/photo-20');
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', 'photo-20');
  const anchor = page.locator('.viewer-thumbnail[data-media-id="photo-20"]');
  await expect(anchor.locator('.photo-frame')).toHaveAttribute('data-photo-state', 'ready');
  await page.locator('.viewer-filmstrip-zone').hover();
  await page.evaluate(() => {
    const win = window as any;
    win.__railNode = document.querySelector('.viewer-filmstrip');
    win.__anchorNode = document.querySelector('.viewer-thumbnail[data-media-id="photo-20"] img');
    win.__candidateBaseline = win.__candidateReads;
    win.__anchorFlashes = 0;
    win.__railRemoved = false;
    win.__railObserver = new MutationObserver(() => {
      if (!win.__railNode.isConnected) win.__railRemoved = true;
      const frame = win.__anchorNode.closest('.photo-frame');
      if (!win.__anchorNode.isConnected || frame?.dataset.photoState !== 'ready') win.__anchorFlashes++;
    });
    win.__railObserver.observe(document.querySelector('#root'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-photo-state'] });
  });
  // These targets are outside the single current-media native snapshot.
  for (const id of ['photo-23', 'photo-21', 'photo-20', 'photo-24']) {
    await page.locator(`.viewer-thumbnail[data-media-id="${id}"]`).click();
    await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', id);
    await expect(page.locator('.media-stage')).toHaveAttribute('data-media-state', 'ready');
  }
  const state = await page.evaluate(() => {
    const win = window as any;
    win.__railObserver.disconnect();
    return {
      sameRail: win.__railNode === document.querySelector('.viewer-filmstrip'),
      sameImage: win.__anchorNode === document.querySelector('.viewer-thumbnail[data-media-id="photo-20"] img'),
      removed: win.__railRemoved, flashes: win.__anchorFlashes,
      pageReads: win.__candidateReads, baseline: win.__candidateBaseline,
    };
  });
  expect(state.sameRail).toBe(true);
  expect(state.sameImage).toBe(true);
  expect(state.removed).toBe(false);
  expect(state.flashes).toBe(0);
  expect(state.pageReads).toBe(state.baseline);
  await expect(page.locator('.loading')).toHaveCount(0);

  // A genuinely missing item must still resolve to the recovery UI.
  await page.evaluate(() => { location.hash = '/viewer/a0/missing-photo'; });
  await expect(page.getByText('媒体不存在', { exact: true })).toBeVisible();
});
