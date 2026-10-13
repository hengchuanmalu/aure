import { expect,test } from "../support/browser.fixture";

test('compact profile rows preserve old data, offer presets and support reorder, save and cancel', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('profileFixtureReady')) return;
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.models.find((model: { id: string }) => model.id === 'm0').fields = [
      { id: 'height', group: '原有分组', label: '身高', value: '168cm' },
      { id: 'legacy', group: '原有分组', label: '备注', value: '原有内容' },
      { id: 'blank', group: '空分组', label: '留空', value: '' },
    ];
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
    sessionStorage.setItem('profileFixtureReady', '1');
  });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).models.find((model: { id: string }) => model.id === 'm0').fields);
  await page.goto('/#/models/m0');
  const original = await stored();
  await expect(page.locator('.profile-fields').getByText('空分组', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '详细资料', exact: true }).click();
  for (const name of ['身高', '生日', '地区', '兴趣']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('分组', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上移', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('身高', { exact: true })).toHaveValue('168');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await stored()).toEqual(original);

  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '详细资料', exact: true }).click();
  await page.getByLabel('身高', { exact: true }).fill('169');
  await page.getByLabel('生日', { exact: true }).fill('2000-06-01');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '身高', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: '体重', exact: true }).click();
  await page.getByLabel('体重', { exact: true }).fill('50');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('menuitem', { name: '自定义资料', exact: true }).click();
  const custom = page.locator('.profile-field-row').last();
  await custom.getByPlaceholder('名称', { exact: true }).fill('摄影风格');
  await custom.getByPlaceholder('填写内容', { exact: true }).fill('氛围');
  const birthdayId = await page.getByLabel('生日', { exact: true }).evaluate(input => input.closest<HTMLElement>('[data-profile-field]')!.dataset.profileField);
  const birthdayIndex = await page.locator('.profile-field-row').evaluateAll((rows, id) => rows.findIndex(row => (row as HTMLElement).dataset.profileField === id), birthdayId);
  await page.getByRole('button', { name: '调整生日顺序', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.profile-field-row').nth(birthdayIndex - 1)).toHaveAttribute('data-profile-field', birthdayId!);
  await page.getByRole('button', { name: '调整体重顺序', exact: true }).dragTo(page.locator('.profile-field-row').first());
  await expect(page.locator('.profile-field-row').first().getByLabel('体重', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除留空', exact: true }).click();
  await page.screenshot({ path: 'verification/profile-fields/editor.png', animations: 'disabled' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const fields = await stored();
  expect(fields.find((field: { id: string }) => field.id === 'height')).toEqual({ id: 'height', label: '身高', value: '169 cm', group: '原有分组' });
  expect(fields.find((field: { id: string }) => field.id === 'legacy')).toEqual(original[1]);
  expect(fields.some((field: { label: string }) => ['地区', '兴趣', '留空'].includes(field.label))).toBe(false);
  expect(fields[0].label).toBe('体重');
  await page.reload();
  await page.getByRole('button', { name: '展开更多', exact: true }).click();
  await expect(page.getByText('169 cm', { exact: true })).toBeVisible();
  await expect(page.getByText('氛围', { exact: true })).toBeVisible();
  await expect(page.getByText('原有内容', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '详细资料', exact: true }).click();
  await expect(page.locator('.profile-field-row').first().getByLabel('体重', { exact: true })).toBeVisible();
  await page.getByLabel('地区', { exact: true }).fill('待丢弃');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  expect(await stored()).toEqual(fields);
});
