import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

test.beforeEach(async ({ page }) => {
  const db = seedFixture();
  db.albums[0].mediaIds = db.media.map(item => item.id);
  await page.addInitScript(db => localStorage.setItem('jingji.mock.v1', JSON.stringify(db)), db);
});

test('compact viewer overlays the floating rail without shrinking the media', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1440, 960], [960, 640], [390, 720]]) {
    await page.setViewportSize({ width, height });
    for (const id of ['p0', 'p1', 'v0']) {
      await page.goto(`/#/viewer/a0/${id}`);
      await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', id);
      await expect.poll(() => page.evaluate(() => {
        const top = document.querySelector('.viewer-top')!.getBoundingClientRect();
        const stage = document.querySelector('.media-stage')!.getBoundingClientRect();
        const rail = document.querySelector('.viewer-filmstrip')!.getBoundingClientRect();
        const transport = document.querySelector('.video-controls')?.getBoundingClientRect();
        return top.height === 48 && stage.top >= top.bottom && stage.bottom === (transport?.top ?? innerHeight)
          && rail.bottom < (transport?.top ?? innerHeight) && rail.left > 0 && rail.right < innerWidth
          && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const id of ['p0', 'p1', 'v0']) {
    await page.goto(`/#/viewer/a0/${id}`);
    await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toBeVisible();
    await expect.poll(() => page.locator(`.media-stage ${id.startsWith('v') ? 'video' : 'img'}`).evaluate((el: HTMLImageElement | HTMLVideoElement) =>
      el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `verification/viewer-redesign/browser-${id}.png` });
  }
  expect(errors).toEqual([]);
});

test('floating filmstrip fades on pointer exit, reappears at the bottom and preserves keyboard access', async ({ page }) => {
  await page.goto('/#/viewer/a0/p0');
  const rail = page.locator('.viewer-filmstrip');
  const stage = await page.locator('.media-stage').boundingBox();
  const box = (await rail.boundingBox())!;
  expect(await rail.evaluate(el => parseFloat(getComputedStyle(el).borderRadius))).toBeGreaterThan(0);
  await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('border-width', '0px');
  await expect(rail).toHaveCSS('box-shadow', 'none');
  await expect(rail.getByRole('button', { name: /滚动缩略图/ })).toHaveCount(0);
  await expect(rail.locator('[title]')).toHaveCount(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(rail).toHaveCSS('opacity', '1');
  const choice = page.locator('.viewer-thumbnail[data-media-id=p1]');
  const before = (await choice.boundingBox())!;
  await choice.hover();
  await expect(choice).toHaveCSS('scale', '1.08');
  const after = (await choice.boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - before.x - before.width / 2)).toBeLessThan(1);
  expect(Math.abs(after.y + after.height - before.y - before.height)).toBeLessThan(1);
  await expect(choice.locator('.photo-frame')).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.333) 0px 4px 10px 0px');
  await page.screenshot({ path: 'verification/viewer-redesign/browser-filmstrip-hover.png' });
  await page.locator('.viewer-thumbnail[data-media-id=p1]').click();
  await page.mouse.move(700, 300);
  await expect(rail).toHaveCSS('opacity', '0');
  expect(await page.locator('.media-stage').boundingBox()).toEqual(stage);
  await page.mouse.move(700, 958);
  await expect(rail).toHaveCSS('opacity', '1');
  await page.mouse.move(700, 300);
  await expect(rail).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await page.getByRole('group', { name: '显示写真集缩略图' }).focus();
  await expect(rail).toHaveCSS('opacity', '1');
  await page.mouse.move(710, 310);
  await page.waitForTimeout(2300);
  await expect(rail).toHaveCSS('opacity', '1');
  await page.locator('.media-stage img').click();
  await expect(rail).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(rail).toHaveCSS('transition-duration', '0s');
  await page.getByRole('group', { name: '显示写真集缩略图' }).press('Enter');
  await choice.hover();
  await expect(choice).toHaveCSS('scale', '1');
  await expect(choice).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.mouse.move(700, 958);
  await expect(rail).toHaveCSS('opacity', '1');
  await page.mouse.move(700, 300);
  await expect(rail).toHaveCSS('opacity', '0');
});

test('continuous filmstrip scrolls without changing the media and selects photos and videos', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto('/#/viewer/a0/p0');
  await page.locator('.viewer-filmstrip-zone').hover();
  await page.getByLabel('滚动浏览缩略图', { exact: true }).hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.locator('.viewer-filmstrip-scroll').evaluate(el => el.scrollLeft)).toBeGreaterThan(200);
  await expect(page).toHaveURL(/viewer\/a0\/p0$/);
  await page.locator('.viewer-thumbnail[data-media-id=v0]').click();
  await expect(page).toHaveURL(/viewer\/a0\/v0$/);
  await expect(page.locator('.viewer-thumbnail-video')).toHaveCount(2);
  await expect(page.locator('.video-controls')).toBeVisible();
  await page.locator('.viewer-thumbnail[data-media-id=v0]').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(/viewer\/a0\/p11$/);
  await expect(page.locator('.video-controls')).toHaveCount(0);
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', 'p11');
  await page.locator('.viewer-thumbnail[aria-current=true]').focus();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/album\/a0$/);
});

test('more menu, fullscreen hiding, image zoom and escape return work in layers', async ({ page }) => {
  await page.goto('/#/viewer/a0/p0');
  await page.waitForTimeout(2300);
  await expect(page.locator('.viewer-controls')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '实际大小', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.viewer')).toBeVisible();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '媒体信息', exact: true }).click();
  await expect(page.locator('.info-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.info-panel')).toHaveCount(0);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.getByRole('group', { name: '图片缩放' })).toContainText('125%');
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.locator('.media-stage img').click();
  await expect(page.locator('.viewer')).toHaveClass(/viewer-fullscreen/);
  await expect(page.locator('.viewer-controls')).toHaveCSS('opacity', '0', { timeout: 5000 });
  await page.mouse.move(700, 300);
  await expect(page.locator('.viewer-controls')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).not.toHaveClass(/viewer-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/album\/a0$/);
});

test('native filmstrip reads bounded pages beyond the first 48 and honors the current filter', async ({ page }) => {
  await page.addInitScript(() => {
    const media = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, kind: 'image', name: `${i}.jpg`,
      src: '/tests/fixtures/media/p-1239291.jpg', width: 1600, height: 1067, tags: [], favorite: false, liked: false, rating: 0 }));
    const db = { version: 1, albums: [{ id: 'many', name: '大量媒体', mediaIds: [], modelIds: [], tags: [] }], media: [], models: [],
      tags: [], groups: [], recent: [], settings: { reducedMotion: true } };
    (window as any).__railRequests = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'plugin:window|is_fullscreen') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'catalog_view') {
        const index = Number(args.query.id.slice(1));
        return { db: { ...db, media: [media[index]] }, page: 0, limit: 96, total: 0, mediaTotal: 500, albumTotal: 1, modelTotal: 0,
          mediaCount: 500, viewer: { index, total: 500, previous: media[index - 1]?.id, next: media[index + 1]?.id } };
      }
      if (command === 'catalog_candidates') {
        (window as any).__railRequests.push(args);
        return { items: media.slice(args.page * 48, (args.page + 1) * 48), total: media.length };
      }
      throw Error(`Unexpected native call: ${command}`);
    } };
  });
  await page.goto('/#/viewer/many/p47');
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', 'p47');
  await page.locator('.viewer-thumbnail[data-media-id=p48]').click();
  await expect(page).toHaveURL(/viewer\/many\/p48$/);
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', 'p48');
  const rail = page.getByRole('group', { name: '写真集缩略图', exact: true });
  expect(await rail.locator('button.viewer-thumbnail').count()).toBeLessThan(24);
  await page.getByRole('group', { name: '写真集缩略图' }).getByLabel('滚动浏览缩略图').focus();
  await page.keyboard.press('End');
  await expect(page.locator('.viewer-thumbnail[data-media-id=p499]')).toBeVisible();
  await page.locator('.viewer-thumbnail[data-media-id=p499]').click();
  await expect(page).toHaveURL(/viewer\/many\/p499$/);
  await expect(page.getByRole('button', { name: '下一项', exact: true })).toBeDisabled();
  const requests = await page.evaluate(() => (window as any).__railRequests);
  expect(requests.some((request: any) => request.page === 10)).toBe(true);
  expect(requests.every((request: any) => request.kind === 'media' && request.query.album === 'many' && request.query.kind === 'all')).toBe(true);
});

test('removing the current native favorite keeps its anchor without duplicating neighboring thumbnails', async ({ page }) => {
  await page.addInitScript(() => {
    const media = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, kind: 'image', name: `${i}.jpg`,
      src: '/tests/fixtures/media/p-1239291.jpg', width: 1600, height: 1067, tags: [], favorite: true, liked: false, rating: 0 }));
    const db = { version: 1, albums: [], media: [], models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: true } };
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'plugin:window|is_fullscreen') return false;
      if (command === 'catalog_view') {
        const anchor = media.find(item => item.id === args.query.id)!;
        const favorites = media.filter(item => item.favorite);
        const index = favorites.filter(item => item.id < anchor.id).length;
        return { db: { ...db, media: [anchor] }, page: 0, limit: 96, total: 0, mediaTotal: favorites.length, albumTotal: 0, modelTotal: 0,
          mediaCount: 3, viewer: { index, total: favorites.length + (anchor.favorite ? 0 : 1), previous: 'p0', next: 'p2' } };
      }
      if (command === 'catalog_candidates') return { items: media.filter(item => item.favorite), total: media.filter(item => item.favorite).length };
      if (command === 'catalog_patch') { for (const patch of args.changes.media) Object.assign(media.find(item => item.id === patch.id)!, patch); return; }
      throw Error(`Unexpected native call: ${command}`);
    } };
  });
  await page.goto('/#/viewer/favorites/p1');
  await expect(page.locator('.viewer-thumbnail')).toHaveCount(3);
  await page.getByRole('button', { name: '取消收藏照片', exact: true }).click();
  await expect(page.getByRole('button', { name: '收藏照片', exact: true })).toBeVisible();
  await expect(page.locator('.viewer-thumbnail')).toHaveCount(3);
  await expect(page.locator('.viewer-thumbnail[aria-current=true]')).toHaveAttribute('data-media-id', 'p1');
  expect(await page.locator('.viewer-thumbnail').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-media-id')))).toEqual(['p0', 'p1', 'p2']);
  await page.locator('.viewer-thumbnail[data-media-id=p2]').click();
  await expect(page).toHaveURL(/viewer\/favorites\/p2$/);
  await expect(page.locator('.viewer-thumbnail')).toHaveCount(2);
});
