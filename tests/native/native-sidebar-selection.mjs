import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild } from '../support/native-session.mjs';
import { checkSidebarSelection } from '../support/sidebar-selection.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => { location.hash = '#/'; });
  const results = await checkSidebarSelection(page);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '发现', exact: true }).click();
  await nav.getByRole('link', { name: '写真库', exact: true }).hover();
  await page.waitForTimeout(300);
  await mkdir('verification/sidebar-selection-installed', { recursive: true });
  await page.screenshot({ path: 'verification/sidebar-selection-installed/selected-and-hover.png' });
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = { ...results, engine: 'Windows WebView2', frontendEntry: receipt.FrontendEntry, executableHash: receipt.ExecutableHash, catalogUnchanged: true, errors };
  await writeFile('verification/sidebar-selection-installed/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  db.close();
  await browser.close();
}
