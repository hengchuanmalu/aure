import { expect } from '@playwright/test';
import { connectNative, nativePage, invokeNative } from '../support/native-session.mjs';

const browser = await connectNative('http://127.0.0.1:9248', 'local.aure.category-delete-test');
try {
  const page = nativePage(browser);
  await invokeNative(page, 'catalog_reset', { seed: {
    version: 1, albums: [], media: [], models: [], groups: [{ id: 'clothing', name: '服装' }, { id: 'empty', name: '空分类' }],
    tags: [{ id: 'stockings', name: '黑丝', groupId: 'clothing' }], settings: { reducedMotion: true }, recent: [], importRules: [],
  } });
  await page.goto('http://tauri.localhost/#/tags');
  await page.reload();
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  const name = page.getByRole('combobox', { name: '标签名称', exact: true });
  await name.fill('黑');
  await expect(page.getByRole('option', { name: '黑丝 服装', exact: true })).toBeVisible();
  await name.press('ArrowDown');
  await name.press('Enter');
  await expect(page.getByRole('dialog', { name: '编辑标签', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await invokeNative(page, 'catalog_view', { query: { route: 'tags' } })).db.tags).toHaveLength(1);
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByRole('combobox', { name: '标签名称', exact: true }).fill('保存草稿');
  await page.getByRole('option', { name: '使用新标签「保存草稿」', exact: true }).click();
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '标签分类选项', exact: true });
  await menu.getByRole('button', { name: '服装', exact: true }).click();
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await page.screenshot({ path: 'verification/tag-category-delete/native-isolated.png' });
  await menu.getByRole('button', { name: '删除分类 服装', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(menu.getByRole('textbox', { name: '搜索或创建分类' })).toBeFocused();
  expect((await invokeNative(page, 'catalog_view', { query: { route: 'tags' } })).db.groups).toHaveLength(2);
  await menu.getByRole('button', { name: '删除分类 服装', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '删除分类', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '标签分类', exact: true })).toHaveText('选择或创建分类');
  await expect(menu.getByRole('button', { name: '未分组', exact: true })).toHaveCount(1);
  await expect(menu.getByRole('button', { name: '删除分类 未分组', exact: true })).toHaveCount(0);
  const view = await invokeNative(page, 'catalog_view', { query: { route: 'tags' } });
  expect(view.db.groups.some(group => group.id === 'clothing')).toBe(false);
  expect(view.db.tags).toEqual([{ id: 'stockings', name: '黑丝', groupId: view.db.groups.find(group => group.name === '未分组').id }]);
  await menu.getByRole('button', { name: '删除分类 空分类', exact: true }).click();
  await page.getByRole('button', { name: '删除分类', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '删除分类 空分类', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('textbox', { name: '搜索或创建分类' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '标签名称', exact: true })).toHaveValue('保存草稿');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const final = await invokeNative(page, 'catalog_view', { query: { route: 'tags' } });
  expect(final.db.tags).toHaveLength(2);
  expect(final.db.tags.every(tag => tag.groupId === final.db.groups[0].id)).toBe(true);
  console.log(JSON.stringify({ engine: 'Windows WebView2', isolated: true, nameSearch: true, existingTagNotDuplicated: true, cancel: true, keyboard: true, tagsPreserved: true, selectedReset: true, emptyCategory: true, draftSave: true }));
} finally { await browser.close(); }
