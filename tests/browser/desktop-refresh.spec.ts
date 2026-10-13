import { expect,test } from '@playwright/test';

test('desktop snapshot refreshes on foreground without discarding an editor draft', async ({ page }) => {
  await page.addInitScript(() => {
    const db = { version: 1, albums: [], media: [], models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: true }, importRules: [] };
    (window as any).__sharedCatalog = db;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_view') {
          const snapshot = structuredClone((window as any).__sharedCatalog);
          return { db: snapshot, page: 0, limit: 96, total: snapshot.albums.length, albumTotal: snapshot.albums.length, modelTotal: snapshot.models.length, mediaTotal: 0, mediaCount: 0 };
        }
        throw Error(`Unexpected native call: ${command}`);
      },
    };
  });
  await page.goto('/#/models');
  await expect(page.getByText('没有找到模特')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__sharedCatalog.models.push({ id: 'external-model', name: '新导入模特', alias: '', bio: '', avatar: '', background: '', avatarFocus: 50, backgroundFocus: 50, fields: [], links: [], photoIds: [], tags: [] });
  });
  await expect(page.locator('.model-card')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: /新导入模特/ })).toBeVisible();
  await page.locator('.topbar').getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByRole('textbox', { name: '模特名称', exact: true }).fill('尚未保存的草稿');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('textbox', { name: '模特名称', exact: true })).toHaveValue('尚未保存的草稿');
});
