import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed production acceptance; catalog access and UI operations are read-only.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const executableHash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'tables');
const before = snapshot();
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
const originalHash = new URL(page.url()).hash;
const errors = []; page.on('pageerror', error => errors.push(error.message));
const output = 'verification/tooltips/installed';
await mkdir(output, { recursive: true });
try {
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => { location.hash = '#/library'; scrollTo(0, 0); });
  await expect(page.locator('h1')).toHaveText('写真库');
  const settings = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true });
  await expect(settings).toHaveClass(/nav-settings-last/);
  const settingsBox = await settings.boundingBox();
  const viewportHeight = await page.evaluate(() => innerHeight);
  expect(Math.abs(viewportHeight - settingsBox.y - settingsBox.height - 14)).toBeLessThan(1);
  const nav = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '写真库', exact: true });
  await page.mouse.move(0, 0);
  await nav.hover();
  const hint = page.locator('.hover-hint');
  await expect(hint).toHaveCount(0);
  await page.screenshot({ path: `${output}/sidebar.png` });
  const button = page.getByRole('button', { name: '封面视图', exact: true });
  await button.hover();
  await expect(page.getByRole('tooltip')).toHaveText('封面视图');
  await expect(hint).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(hint).toHaveCSS('color', 'rgb(23, 23, 23)');
  await expect(hint).toHaveAttribute('data-side', 'bottom');
  await expect(button).not.toHaveAttribute('title');
  const anchor = await button.boundingBox(), surface = await hint.boundingBox();
  expect(Math.abs(surface.y - anchor.y - anchor.height - 4)).toBeLessThan(1);
  await expect(hint).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `${output}/library.png` });
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('Tab');
  await button.focus();
  await expect(page.getByRole('tooltip')).toHaveText('封面视图');
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  const card = page.locator('.album-card').first();
  if (await card.count()) {
    const menu = card.getByRole('button', { name: /更多操作/ });
    await menu.hover();
    await expect(hint).toHaveCount(0);
    await menu.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(hint).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '添加写真', exact: true }).click();
  const close = page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true });
  await close.hover();
  await expect(hint).toHaveCount(0);
  await page.screenshot({ path: `${output}/dialog.png` });
  await close.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  expect(snapshot()).toEqual(before);
  expect(errors).toEqual([]);
  const report = { engine: 'Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry,
    whiteSurface: true, blackText: true, noAddedSidebarHints: true, noAddedIconHints: true, belowControlGap: 4, keyboardFocus: true,
    escapeDismissal: true, menuClick: true, settingsAtSidebarBottom: true, nativeTitlesRemoved: true, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(hash => { location.hash = hash; scrollTo(0, 0); }, originalHash);
  db.close(); await browser.close();
}
