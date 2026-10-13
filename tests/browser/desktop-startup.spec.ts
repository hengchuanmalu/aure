import { expect,test,type Page } from '@playwright/test';

async function packagedPage(page: Page, delay: number | null) {
  await page.route('http://tauri.localhost/**', async route => {
    const url = new URL(route.request().url());
    const origin = test.info().project.use.baseURL || 'http://127.0.0.1:1420';
    const response = await page.request.get(`${origin}${url.pathname}${url.search}`);
    await route.fulfill({ response });
  });
  await page.addInitScript(({ delay }) => {
    const model = (name: string) => ({ id: name, name, alias: '', bio: '', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] });
    const empty = { version: 1, albums: [], media: [], models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: true } };
    localStorage.setItem('jingji.mock.v1', JSON.stringify({ ...empty, models: [model('旧预览模特')] }));
    const connect = () => {
      (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_view') return { db: { ...empty, models: [model('正式图库模特')] }, page: 0, limit: 96, total: 1, albumTotal: 0, modelTotal: 1, mediaTotal: 0, mediaCount: 0 };
        throw Error(`Unexpected native call: ${command}`);
      } };
    };
    if (sessionStorage.getItem('connect-on-retry')) connect();
    else if (delay !== null) setTimeout(connect, delay);
  }, { delay });
  await page.goto('http://tauri.localhost/#/models');
}

test('packaged startup waits for a delayed bridge and never displays the legacy preview library', async ({ page }) => {
  await packagedPage(page, 1500);
  await expect(page.getByRole('status')).toHaveText('正在打开aure…');
  await expect(page.getByRole('link', { name: /旧预览模特/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /正式图库模特/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /旧预览模特/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).models[0].name)).toBe('旧预览模特');
});

test('missing desktop bridge shows recovery and retry reconnects without clearing legacy data', async ({ page }) => {
  await packagedPage(page, null);
  await expect(page.getByRole('heading', { name: '暂时无法打开图库' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/桌面接口未就绪/)).toBeVisible();
  await expect(page.getByRole('link', { name: /旧预览模特/ })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.setItem('connect-on-retry', '1'));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('link', { name: /正式图库模特/ })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).models[0].name)).toBe('旧预览模特');
});

test('ordinary browser preview still uses its own library', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jingji.mock.v1', JSON.stringify({ version: 1, albums: [], media: [], models: [{ id: 'preview', name: '浏览器预览模特', alias: '', bio: '', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [] }], tags: [], groups: [], recent: [], settings: { reducedMotion: true } })));
  await page.goto('/#/models');
  await expect(page.getByRole('link', { name: /浏览器预览模特/ })).toBeVisible();
});
