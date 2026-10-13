import { expect, test, type Page } from '../support/browser.fixture';
import { seedFixture } from '../support/demo.fixture';

async function nativeRecent(page: Page, failClear = false, failRefreshAfterClear = false) {
  await page.addInitScript(({ fixture, failClear, failRefreshAfterClear }) => {
    let recent = JSON.parse(sessionStorage.getItem('journey.recent') || JSON.stringify(fixture.recent)) as typeof fixture.recent;
    let failNextRead = false;
    (window as any).__journeyCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any = {}) => {
        (window as any).__journeyCalls.push({ command, args });
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_recent') {
          if (!args.entry && failClear) throw Error('Synthetic history write failure');
          recent = args.entry ? [args.entry, ...recent.filter(item => item.albumId !== args.entry.albumId)] : [];
          sessionStorage.setItem('journey.recent', JSON.stringify(recent));
          if (!args.entry && failRefreshAfterClear) failNextRead = true;
          return structuredClone(recent);
        }
        if (command === 'catalog_view') {
          if (failNextRead) { failNextRead = false; throw Error('Synthetic post-write read failure'); }
          const query = args.query;
          const albums = query.route === 'recent'
            ? recent.flatMap(item => fixture.albums.filter(album => album.id === item.albumId))
            : query.route === 'album' ? fixture.albums.filter(album => album.id === query.id) : fixture.albums;
          const album = albums[0];
          return {
            db: { ...structuredClone(fixture), albums: structuredClone(albums), recent: structuredClone(recent) },
            page: 0, limit: 96, total: query.route === 'album' ? album?.mediaIds.length || 0 : albums.length,
            albumTotal: fixture.albums.length, modelTotal: fixture.models.length,
            mediaTotal: query.route === 'album' ? album?.mediaIds.length || 0 : fixture.media.length,
            mediaCount: fixture.media.length, visibleMediaIds: query.route === 'album' ? album?.mediaIds || [] : [],
          };
        }
        throw Error(`Unexpected native call ${command}`);
      },
    };
  }, { fixture: seedFixture(), failClear, failRefreshAfterClear });
}

test('clearing recent browsing immediately clears its native cards and count', async ({ page }) => {
  await nativeRecent(page);
  await page.goto('/#/recent');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
  await expect(page.locator('.album-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
});

test('a new album visit replaces a cached recent list when returning through navigation', async ({ page }) => {
  await nativeRecent(page);
  await page.goto('/#/recent');
  await expect(page.getByRole('link', { name: '打开写真 把夏天留下', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('link', { name: '写真库', exact: true }).click();
  await page.getByRole('link', { name: '打开写真 城市漫游', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('城市漫游');
  await expect.poll(() => page.evaluate(() => (window as any).__journeyCalls.filter((call: any) => call.command === 'catalog_recent' && call.args.entry?.albumId === 'a1').length)).toBe(1);
  await navigation.getByRole('link', { name: '最近浏览', exact: true }).click();
  await expect(page.locator('.album-card')).toHaveCount(2);
  await expect(page.locator('.album-card .cover-link').first()).toHaveAttribute('aria-label', '打开写真 城市漫游');
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await navigation.getByRole('link', { name: '写真库', exact: true }).click();
  await navigation.getByRole('link', { name: '最近浏览', exact: true }).click();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
});

test('a failed clear keeps the recent cards and gives a recoverable failure message', async ({ page }) => {
  await nativeRecent(page, true);
  await page.goto('/#/recent');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('浏览记录保存失败，图库未受影响');
  await expect(page.locator('.album-card')).toHaveCount(1);
});

test('a history write followed by a failed refresh reports saved history and retries only the read', async ({ page }) => {
  await nativeRecent(page, false, true);
  await page.goto('/#/recent');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('浏览记录已保存，但刷新失败');
  await expect(page.getByRole('status')).toHaveCount(0);
  await alert.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__journeyCalls.filter((call: any) => call.command === 'catalog_recent').length)).toBe(1);
});

test('successful group persistence closes its editor when refresh fails and blocks duplicate writes until retry', async ({ page }) => {
  await page.addInitScript(fixture => {
    let failNextRead = false;
    (window as any).__journeyWrites = [];
    (window as any).__journeyBackend = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any = {}) => {
      if (command === 'catalog_initialize') return false;
      if (command === 'catalog_patch') {
        (window as any).__journeyWrites.push(structuredClone(args.changes));
        for (const group of args.changes.groups || []) {
          const index = fixture.groups.findIndex(item => item.id === group.id);
          if (index < 0) fixture.groups.push(group);
          else fixture.groups[index] = { ...fixture.groups[index], ...group };
        }
        failNextRead = true;
        return;
      }
      if (command === 'catalog_view') {
        if (failNextRead) { failNextRead = false; throw Error('Synthetic post-write read failure'); }
        return { db: structuredClone(fixture), page: 0, limit: 96, total: 0, albumTotal: fixture.albums.length,
          modelTotal: fixture.models.length, mediaTotal: 0, mediaCount: fixture.media.length };
      }
      throw Error(`Unexpected native call ${command}`);
    } };
  }, seedFixture());
  await page.goto('/#/tags/manage');
  const name = '只保存一次的分组';
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const refreshAlert = page.locator('.toast[role="alert"]');
  await expect(refreshAlert).toContainText('更改已保存，但刷新失败');
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('保存失败，请重试');
  expect(await page.evaluate(() => (window as any).__journeyWrites.length)).toBe(1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await refreshAlert.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  expect(await page.evaluate(name => (window as any).__journeyBackend.groups.filter((group: any) => group.name === name).length, name)).toBe(1);
  expect(await page.evaluate(() => (window as any).__journeyWrites.length)).toBe(1);
});

test('favorites media selection survives reload and history while retaining its album view', async ({ page }) => {
  await page.goto('/#/favorites?view=cover');
  await page.getByRole('button', { name: /^照片与视频 ·/ }).click();
  await expect(page).toHaveURL(/#\/favorites\?view=cover&tab=media$/);
  await expect(page.locator('.media-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /^照片与视频 ·/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.media-card')).toHaveCount(1);
  await page.getByRole('button', { name: /^写真集 ·/ }).click();
  await expect(page.getByRole('button', { name: '封面视图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.goBack();
  await expect(page.locator('.media-card')).toHaveCount(1);
  await page.locator('.media-card .media-open').first().click();
  await expect(page.locator('.viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await expect(page.locator('.media-card')).toHaveCount(1);
});

test('empty search and combined tag filters recover independently through back and reload', async ({ page }) => {
  await page.goto('/#/tags?tag=t00&tag=t10&model=m0&sort=name&order=desc&view=cover');
  await expect(page.locator('.album-card')).toHaveCount(2);
  const search = page.getByRole('combobox', { name: '搜索写真、模特或标签', exact: true });
  await search.fill('不存在的内容');
  await search.press('Enter');
  await expect(page.getByText('没有找到匹配的写真', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(page.locator('.album-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '筛选模特 林夏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '清除全部筛选', exact: true }).click();
  await expect(page.locator('.album-card')).toHaveCount(12);
  await expect(page).toHaveURL(/sort=name&order=desc&view=cover$/);
  await page.goBack();
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.album-card')).toHaveCount(2);
});

test('typing while a selected search result is loading survives the destination commit', async ({ page }) => {
  await page.route(/\/(?:src\/pages\/AlbumDetail\.tsx|assets\/AlbumDetail-[^/]+\.js)(?:\?|$)/, async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.goto('/#/library');
  const search = page.getByRole('combobox', { name: '搜索写真、模特或标签', exact: true });
  await search.fill('城市漫游');
  await expect(page.locator('[data-value="album:a1"]')).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(/#\/album\/a1$/);
  await search.fill('林夏');
  await expect(page.locator('h1')).toHaveText('城市漫游');
  await expect(search).toHaveValue('林夏');
  await search.press('Escape');
  await search.press('Control+k');
  await expect(page.locator('[data-value="model:m0"]')).toBeVisible();
});
