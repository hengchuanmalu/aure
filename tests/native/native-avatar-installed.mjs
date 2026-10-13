import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance of the installed production catalog. All edits stay in a discarded draft.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';

import { join } from 'node:path';
const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const browser = await connectNative('http://127.0.0.1:9237', "local.jingji.desktop");
try {
  const page = nativePage(browser);
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const candidates = await invoke('catalog_candidates', { kind: 'models', page: 0, query: {} });
  const model = candidates.items[0];
  if (!model) throw Error('Production catalog has no model for installed acceptance');
  await page.goto(`http://tauri.localhost/#/models/${model.id}`);
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  for (const name of ['基本资料', '详细资料', '社交链接', '关联写真集', '模特头像']) {
    await page.getByRole('button', { name, exact: true }).click();
    const nav = page.getByRole('navigation', { name: '编辑资料分区' });
    const positions = await nav.locator('button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(positions).size).toBe(1);
    const navBox = await nav.boundingBox();
    const contentBox = await page.locator('.editor-content').boundingBox();
    expect(contentBox.y).toBeGreaterThan(navBox.y + navBox.height);
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  }
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前头像', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择照片', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '从本地选择图片', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部图片', exact: true })).toHaveCount(0);
  await expect(page.locator('.picker-pages, input[type="number"]')).toHaveCount(0);
  await expect(page.getByText('拖动照片调整位置，方向键可微调', { exact: true })).toHaveCount(0);
  expect(await page.locator('.avatar-editor-modal .dialog-content').evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
  if (model.avatar) await expect.poll(() => page.locator('.avatar-crop-stage img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const choices = page.locator('.avatar-photo-grid button');
  const linked = await invoke('catalog_candidates', { kind: 'albums', page: 0, query: { model: model.id } });
  if (linked.items.length) await page.getByRole('group', { name: '头像图片来源' }).getByRole('button', { name: linked.items[0].name, exact: true }).click();
  await expect(choices.first()).toBeVisible();
  expect(await choices.count()).toBeLessThanOrEqual(48);
  await choices.first().click();
  await page.getByLabel('头像缩放').fill('150');
  await page.getByRole('group', { name: '头像裁切区域' }).hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.getByLabel('头像缩放').inputValue()).toBe('166');
  await page.getByRole('group', { name: '头像裁切区域' }).press('ArrowUp');
  await expect.poll(() => page.locator('.avatar-crop-stage img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await mkdir('verification/avatar-installed', { recursive: true });
  await page.screenshot({ path: 'verification/avatar-installed/editor.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  if (await page.getByRole('alertdialog').count()) await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const report = { installedBuild: true, engine: 'Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry,
    modelEditorHorizontalSections: true, avatarPreview: true, selection: true, wheelZoom: true, outerScrollbarHidden: true, allPhotosRemoved: true, paginationBarRemoved: true,
    helpTextRemoved: true, draftCrop: true, cancel: true, catalogUnchanged: true, errors };
  await writeFile('verification/avatar-installed/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); await browser.close(); }
