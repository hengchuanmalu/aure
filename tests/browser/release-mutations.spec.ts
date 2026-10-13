import { expect, test } from '../support/browser.fixture';
import { seedFixture } from '../support/demo.fixture';

async function delayedWrites(page: import('@playwright/test').Page, rejectFirst = false) {
  await page.addInitScript(({ fixture, rejectFirst }) => {
    const w = window as any;
    w.__mutationWrites = [];
    w.__unhandledMutations = [];
    w.__windowCalls = [];
    w.__mutationCatalog = fixture;
    let writes = 0;
    window.addEventListener('unhandledrejection', event => {
      w.__unhandledMutations.push(String(event.reason));
      event.preventDefault();
    });
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command: string, args: any = {}) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'catalog_recent') return [];
      if (command === 'plugin:window|is_fullscreen') {
        w.__windowCalls.push({ command, fail: !!w.__failFullscreenRead });
        if (w.__failFullscreenRead) throw Error('Synthetic window read failure');
        return false;
      }
      if (command === 'plugin:window|set_fullscreen') {
        w.__windowCalls.push({ command, fail: !!w.__failFullscreenWrite });
        if (w.__failFullscreenWrite) throw Error('Synthetic window write failure');
        return;
      }
      if (command === 'image_thumbnail') return fixture.media[0].src;
      if (command === 'catalog_patch') {
        writes++;
        await new Promise(resolve => setTimeout(resolve, 180));
        if (rejectFirst && writes === 1) throw Error('Synthetic storage failure');
        w.__mutationWrites.push(structuredClone(args.changes));
        for (const kind of ['albums', 'media'] as const) {
          for (const patch of args.changes[kind] || []) {
            const entity = fixture[kind].find(item => item.id === patch.id);
            if (entity) Object.assign(entity, patch);
          }
        }
        return;
      }
      if (command === 'catalog_candidates') return { items: fixture.media, total: fixture.media.length };
      if (command === 'catalog_view') {
        const query = args.query;
        const album = fixture.albums.find(item => item.id === query.id || item.id === query.owner);
        return {
          db: structuredClone(fixture), page: 0, limit: 96,
          total: query.route === 'album' ? album?.mediaIds.length || 0 : fixture.albums.length,
          albumTotal: fixture.albums.length, modelTotal: fixture.models.length,
          mediaTotal: fixture.media.length, mediaCount: fixture.media.length,
          visibleMediaIds: album?.mediaIds || [],
          viewer: query.route === 'viewer' ? { index: 0, total: album?.mediaIds.length || 0, next: album?.mediaIds[1] } : undefined,
        };
      }
      throw Error(`Unexpected native call: ${command}`);
    } };
  }, { fixture: seedFixture(), rejectFirst });
}

for (const surface of ['card', 'detail', 'viewer'] as const) {
  test(`two queued favorite actions on ${surface} toggle the latest persisted value`, async ({ page }) => {
    await delayedWrites(page);
    await page.goto(surface === 'card' ? '/#/library' : surface === 'detail' ? '/#/album/a0' : '/#/viewer/a0/p0');
    const favorite = surface === 'card'
      ? page.getByRole('button', { name: '取消收藏 光落在肩上', exact: true })
      : page.getByRole('button', { name: surface === 'detail' ? '取消收藏写真集' : '收藏照片', exact: true });
    await expect(favorite).toBeVisible();
    await favorite.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => page.evaluate(() => (window as any).__mutationWrites.length)).toBe(2);
    const state = await page.evaluate(surface => {
      const catalog = (window as any).__mutationCatalog;
      return surface === 'viewer' ? catalog.media[0].favorite : catalog.albums[0].favorite;
    }, surface);
    expect(state).toBe(surface !== 'viewer');
    expect(await page.evaluate(() => (window as any).__unhandledMutations)).toEqual([]);
  });

  test(`a failed favorite write on ${surface} preserves data and can be retried without an unhandled rejection`, async ({ page }) => {
    await delayedWrites(page, true);
    await page.goto(surface === 'card' ? '/#/library' : surface === 'detail' ? '/#/album/a0' : '/#/viewer/a0/p0');
    const favorite = surface === 'card'
      ? page.getByRole('button', { name: '取消收藏 光落在肩上', exact: true })
      : page.getByRole('button', { name: surface === 'detail' ? '取消收藏写真集' : '收藏照片', exact: true });
    await favorite.click();
    await expect(page.locator('.toast[role="status"]')).toContainText('失败');
    expect(await page.evaluate(() => (window as any).__unhandledMutations)).toEqual([]);
    await expect(favorite).toBeVisible();
    await favorite.click();
    await expect.poll(() => page.evaluate(() => (window as any).__mutationWrites.length)).toBe(1);
    expect(await page.evaluate(surface => {
      const catalog = (window as any).__mutationCatalog;
      return surface === 'viewer' ? catalog.media[0].favorite : catalog.albums[0].favorite;
    }, surface)).toBe(surface === 'viewer');
  });
}

test('queued clicks on the same media rating restore the unrated state', async ({ page }) => {
  await delayedWrites(page);
  await page.goto('/#/viewer/a0/p0');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '媒体信息', exact: true }).click();
  const rating = page.getByRole('button', { name: '4 星', exact: true });
  await rating.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => page.evaluate(() => (window as any).__mutationWrites.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__mutationCatalog.media[0].rating)).toBe(0);
});

test('queued media tag choices preserve independent toggles from the latest saved tags', async ({ page }) => {
  await delayedWrites(page);
  await page.goto('/#/viewer/a0/p0');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '媒体信息', exact: true }).click();
  await page.locator('.info-panel .tag-picker').evaluate(picker => {
    const buttons = [...picker.querySelectorAll('button')];
    buttons.find(button => button.textContent?.trim() === '复古')!.click();
    buttons.find(button => button.textContent?.trim() === '胶片')!.click();
    buttons.find(button => button.textContent?.trim() === '复古')!.click();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__mutationWrites.length)).toBe(3);
  expect(await page.evaluate(() => (window as any).__mutationCatalog.media[0].tags)).toEqual(['t00', 't10', 't02']);
});

test('viewer can return to the album after the window refuses to leave fullscreen', async ({ page }) => {
  await delayedWrites(page);
  await page.goto('/#/viewer/a0/p0');
  await expect(page.locator('.media-stage')).toBeVisible();
  await page.evaluate(() => { (window as any).__failFullscreenWrite = true; });
  await page.getByRole('button', { name: '返回详情', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__windowCalls)).toContainEqual({ command: 'plugin:window|set_fullscreen', fail: true });
  await expect(page.locator('.album-hero')).toBeVisible();
  await expect(page.locator('.toast[role="status"]')).toHaveText('窗口状态恢复失败，请手动退出全屏');
  expect(await page.evaluate(() => (window as any).__unhandledMutations)).toEqual([]);
});

test('failed fullscreen state reads leave the viewer usable and Escape gives a recoverable error', async ({ page }) => {
  await delayedWrites(page);
  await page.goto('/#/viewer/a0/p0');
  await expect(page.locator('.media-stage')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__failFullscreenRead = true;
    window.dispatchEvent(new Event('resize'));
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__windowCalls)).toContainEqual({ command: 'plugin:window|is_fullscreen', fail: true });
  await expect(page.locator('.viewer-error')).toContainText('无法退出全屏，请重试或返回详情');
  expect(await page.evaluate(() => (window as any).__unhandledMutations)).toEqual([]);
  await page.evaluate(() => { (window as any).__failFullscreenRead = false; });
  await page.locator('.viewer-error').getByRole('button', { name: '返回详情', exact: true }).click();
  await expect(page.locator('.album-hero')).toBeVisible();
});

for (const remote of [false, true]) {
  test(`model route changes close the previous editor and reopening reads the new entity (${remote ? 'desktop' : 'preview'})`, async ({ page }) => {
    if (remote) {
      await page.addInitScript(fixture => {
        (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any = {}) => {
          if (command === 'catalog_initialize') return false;
          if (command === 'image_thumbnail') return fixture.media[0].src;
          if (command === 'catalog_entity') {
            await new Promise(resolve => setTimeout(resolve, 120));
            return fixture.models.find(model => model.id === args.id);
          }
          if (command === 'catalog_model_albums') return fixture.albums.filter(album => album.modelIds.includes(args.id)).map(album => album.id);
          if (command === 'catalog_view') return { db: structuredClone(fixture), page: 0, limit: 96, total: 0,
            albumTotal: fixture.albums.length, modelTotal: fixture.models.length, mediaTotal: 0, mediaCount: fixture.media.length };
          throw Error(`Unexpected native call: ${command}`);
        } };
      }, seedFixture());
    }
    await page.goto('/#/models/m0');
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模特名称', exact: true })).toHaveValue('林夏');
    await page.evaluate(() => { location.hash = '/models/m1'; });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模特名称', exact: true })).toHaveValue('许知遥');
  });
}
