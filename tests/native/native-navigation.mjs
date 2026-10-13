import { connectNative, nativePage } from '../support/native-session.mjs';
// Read-only UI smoke test for the installed Windows WebView2 app. Never seeds/reset catalogs.
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9225', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('No installed Tauri WebView2 page found');
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  const before = await invoke('catalog_view', { query: { route: 'library', limit: 96 } });
  await mkdir('verification/native-navigation', { recursive: true });
  await page.goto('http://tauri.localhost/#/library');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '收藏', exact: true })).toBeVisible();
  await expect(nav.locator('a[title]')).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /标签/ })).toHaveCount(0);
  await expect(page.locator('.library-results')).toContainText(`${before.albumTotal} 本`);
  await page.getByRole('combobox', { name: '排序', exact: true }).click();
  await expect(page.getByRole('option', { name: '名称排序' })).toBeVisible();
  await page.screenshot({ path: 'verification/native-navigation/sort.png' });
  await page.getByRole('option', { name: '名称排序' }).click();
  await expect(page).toHaveURL(/sort=name/);
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('link', { name: '标签', exact: false }).click();
  await expect(page.locator('h1')).toHaveText('标签');
  await expect(nav.getByRole('link', { name: '设置', exact: true })).toHaveClass(/active/);
  await nav.getByRole('link', { name: '模特', exact: true }).click();
  await expect(page.locator('.model-card')).toHaveCount(Math.min(48, before.modelTotal));
  if (before.modelTotal) {
    const index = page.getByRole('navigation', { name: '模特字母索引' });
    await expect(index).toHaveCSS('opacity', '0');
    const zone = await page.locator('.model-index-zone').boundingBox();
    await page.mouse.move(zone.x + zone.width - 8, zone.y + zone.height / 2);
    await expect(index).toHaveCSS('opacity', '1');
    expect(await index.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
    await page.screenshot({ path: 'verification/native-navigation/models.png' });
    await index.locator('button:not(:disabled)').first().click();
    await page.mouse.move(400, 100);
    await expect(index).toHaveCSS('opacity', '0');
  }
  await page.getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByRole('textbox', { name: '模特名称', exact: true }).fill('临时验证草稿');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('textbox', { name: '模特名称', exact: true })).toHaveValue('临时验证草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await invoke('catalog_view', { query: { route: 'library', limit: 96 } });
  expect([after.albumTotal, after.modelTotal, after.mediaCount]).toEqual([before.albumTotal, before.modelTotal, before.mediaCount]);
  expect(after.db.settings).toEqual(before.db.settings);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ engine: 'Windows WebView2', albums: after.albumTotal, models: after.modelTotal, media: after.mediaCount, errors }));
} finally { await browser.close(); }
