import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// The installed application is read-only: opening/cancelling its editor never selects media.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db, 'hash');
if (process.argv.includes('--compare-preinstall')) {
  expect(before).toBe(await readFile('verification/automatic-import-native/pre-install-catalog.txt', 'utf8'));
}
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.goto('http://tauri.localhost/#/library?create=1');
  await expect(page.getByRole('button', { name: '从文件夹导入', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '批量导入写真' })).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(catalogSnapshot(db, 'hash')).toBe(before);
  expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
  const output = resolve('verification/automatic-import-native');
  await mkdir(output, { recursive: true });
  const report = { engine: 'installed Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry, importEntry: true, catalogUnchanged: true, integrity: 'ok' };
  await writeFile(join(output, 'installed.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { db.close(); await browser.close(); }
