import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild, invokeNative } from '../support/native-session.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const originalHash = await page.evaluate(() => location.hash);
try {
  expect(await page.locator('script[type="module"]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.__categoryAuditFetch = originalFetch;
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      const command = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname === 'ipc.localhost' && command.startsWith('catalog_') && !['catalog_view', 'catalog_search'].includes(command)) {
        // Return an IPC error response: rejecting fetch can trigger the native fallback.
        return Promise.resolve(new Response(JSON.stringify('正式图库只读验收：写入已阻止'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }));
      }
      return originalFetch.call(window, input, options);
    };
  });
  await expect(invokeNative(page, 'catalog_operation', { op: { type: 'removeTag', id: '__guard_probe__', group: true } })).rejects.toThrow('写入已阻止');
  await page.evaluate(() => { location.hash = '#/tags'; });
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  const tagView = await invokeNative(page, 'catalog_view', { query: { route: 'tags' } });
  if (tagView.db.tags.length) {
    const tag = tagView.db.tags[0];
    const group = tagView.db.groups.find(group => group.id === tag.groupId);
    const name = page.getByRole('combobox', { name: '标签名称', exact: true });
    await expect(name).toHaveAttribute('placeholder', '搜索或输入新标签');
    await name.fill(tag.name);
    const suggestions = page.getByRole('dialog', { name: '标签名称候选', exact: true });
    await expect(suggestions).toHaveCSS('opacity', '1');
    await page.screenshot({ path: 'verification/tag-category-delete/installed-name-search.png' });
    await suggestions.getByRole('option', { name: `${tag.name} ${group?.name || '未分组'}`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: '编辑标签', exact: true })).toBeVisible();
    await expect(name).toHaveValue(tag.name);
    await expect(page.getByRole('button', { name: '标签分类', exact: true })).toHaveText(group?.name || '选择或创建分类');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '添加标签', exact: true }).click();
  }
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '标签分类选项', exact: true });
  await expect(menu).toHaveCSS('opacity', '1');
  const view = await invokeNative(page, 'catalog_view', { query: { route: 'tags' } });
  const groups = view.db.groups.filter(group => group.name !== '未分组');
  await expect(menu.locator('.tag-category-remove')).toHaveCount(groups.length);
  await expect(menu.getByRole('button', { name: '删除分类 未分组', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'verification/tag-category-delete/installed.png' });
  if (groups.length) {
    await menu.getByRole('button', { name: `删除分类 ${groups[0].name}`, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText(`删除分类「${groups[0].name}」`);
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(menu.getByRole('textbox', { name: '搜索或创建分类' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  } else {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  expect(catalogSnapshot(db)).toBe(before);
  const report = { engine: 'Windows WebView2', installed: true, executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry, tagNameSearch: !!tagView.db.tags.length, categoryCrosses: groups.length, confirmationCancelled: !!groups.length, catalogUnchanged: true };
  await writeFile('verification/tag-category-delete/installed.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await page.evaluate(() => { if (window.__categoryAuditFetch) { window.fetch = window.__categoryAuditFetch; delete window.__categoryAuditFetch; } });
  await browser.close(); db.close();
}
