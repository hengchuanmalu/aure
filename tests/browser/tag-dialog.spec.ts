import { expect,test } from "../support/browser.fixture";

const saved = (page: any) => page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
const open = async (page: any) => {
  await page.goto('/#/tags?tag=t00&sort=name');
  await page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加标签', exact: true })).toBeVisible();
};

test('tag names search existing tags without writing and can save a fresh name', async ({ page }) => {
  await open(page);
  const before = await saved(page);
  const name = page.getByRole('combobox', { name: '标签名称', exact: true });
  await expect(name).toHaveAttribute('placeholder', '搜索或输入新标签');
  await name.fill('清');
  const menu = page.getByRole('dialog', { name: '标签名称候选', exact: true });
  await expect(menu.getByRole('option', { name: '清新 风格', exact: true })).toBeVisible();
  await expect(menu.getByRole('option', { name: '清冷 情绪', exact: true })).toBeVisible();
  await expect(menu).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'verification/tag-name-search-browser.png' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '编辑标签', exact: true })).toBeVisible();
  await expect(name).toHaveValue('清新');
  await expect(page.getByRole('button', { name: '标签分类', exact: true })).toHaveText('风格');
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await open(page);
  await name.fill('新名称');
  await menu.getByRole('option', { name: '使用新标签「新名称」', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(name).toBeFocused();
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const after = await saved(page);
  expect(after.tags.filter((tag: any) => tag.name === '新名称')).toHaveLength(1);
  expect(after.tags).toHaveLength(before.tags.length + 1);
});

test('tag suggestions preserve input and IME confirmation never submits the tag draft', async ({ page }) => {
  await open(page);
  const before = await saved(page);
  const name = page.getByRole('combobox', { name: '标签名称', exact: true });
  await name.fill('清');
  await name.dispatchEvent('compositionstart');
  await expect(page.getByRole('dialog', { name: '标签名称候选', exact: true })).toHaveCount(0);
  await name.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true });
  expect(await saved(page)).toEqual(before);
  await name.dispatchEvent('compositionend');
  await expect(page.getByRole('dialog', { name: '标签名称候选', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '标签名称候选', exact: true })).toHaveCount(0);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('清');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await saved(page)).toEqual(before);
});

test('new dialog opens in place, counts twenty characters, and cancel and Escape discard drafts', async ({ page }) => {
  await open(page);
  const before = await saved(page);
  const name = page.getByRole('combobox', { name: '标签名称', exact: true });
  await expect(page).toHaveURL(/#\/tags\?tag=t00&sort=name$/);
  await name.fill('字'.repeat(21));
  await expect(name).toHaveValue('字'.repeat(20));
  await expect(page.getByText('20/20', { exact: true })).toBeVisible();
  await name.press('Escape');
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索或创建分类' }).fill('尚未保存分类');
  await page.getByRole('button', { name: '创建「尚未保存分类」' }).click();
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true })).toBeFocused();
});

test('creating an inline category saves it with the tag, rejects duplicates and keeps failed drafts', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: '标签名称', exact: true }).fill('蕾丝');
  await page.getByRole('combobox', { name: '标签名称', exact: true }).press('Escape');
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索或创建分类' }).fill('服饰细节');
  await page.getByRole('button', { name: '创建「服饰细节」' }).click();
  await page.screenshot({ path: 'verification/tag-dialog-browser.png' });
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let db = await saved(page);
  const group = db.groups.find((group: any) => group.name === '服饰细节');
  expect(db.tags.find((tag: any) => tag.name === '蕾丝').groupId).toBe(group.id);
  await page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByRole('combobox', { name: '标签名称' }).fill('蕾丝');
  await page.getByRole('combobox', { name: '标签名称' }).press('Escape');
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await page.getByRole('dialog', { name: '标签分类选项' }).getByRole('button', { name: '服饰细节', exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('此分类已存在同名标签');
  await page.getByRole('combobox', { name: '标签名称' }).fill('新标签');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'jingji.mock.v1') { Storage.prototype.setItem = original; throw new DOMException('test storage failure', 'QuotaExceededError'); }
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败，请重试');
  await expect(page.getByRole('combobox', { name: '标签名称' })).toHaveValue('新标签');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  db = await saved(page);
  expect(db.tags.filter((tag: any) => tag.name === '新标签')).toHaveLength(1);
});

test('category crosses confirm deletion, preserve tag references and reset the selected category', async ({ page }) => {
  await open(page);
  const before = await saved(page);
  await page.getByRole('combobox', { name: '标签名称', exact: true }).fill('保留中的草稿');
  await page.getByRole('combobox', { name: '标签名称', exact: true }).press('Escape');
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '标签分类选项' });
  await expect(menu.getByRole('button', { name: '删除分类 未分组', exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: '服装', exact: true }).click();
  await page.getByRole('button', { name: '标签分类', exact: true }).click();
  await expect(menu).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'verification/tag-category-delete-browser.png' });
  await menu.getByRole('button', { name: '删除分类 服装', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('组内标签会移到未分组');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await expect(menu.getByRole('textbox', { name: '搜索或创建分类' })).toBeFocused();
  await menu.getByRole('button', { name: '删除分类 服装', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'jingji.mock.v1') { Storage.prototype.setItem = original; throw new DOMException('test deletion failure', 'QuotaExceededError'); }
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '删除分类', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toHaveText('操作失败，请重试');
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button', { name: '删除分类', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: '删除分类 服装', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: '未分组', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '标签分类', exact: true })).toHaveText('选择或创建分类');
  const after = await saved(page);
  const ungrouped = after.groups.find((group: any) => group.name === '未分组');
  expect(after.tags).toEqual(before.tags.map((tag: any) => tag.groupId === 'g4' ? { ...tag, groupId: ungrouped.id } : tag));
  for (const kind of ['albums', 'media', 'models']) expect(after[kind]).toEqual(before[kind]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: '标签名称', exact: true })).toHaveValue('保留中的草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await saved(page)).toEqual(after);
});
