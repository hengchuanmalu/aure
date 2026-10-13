import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only verification of the installed production catalog.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const executableHash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const settings = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value);
const albumTotal = db.prepare("SELECT count(*) total FROM entities WHERE kind='albums'").get().total;
const mediaTotal = db.prepare("SELECT count(*) total FROM entities WHERE kind='media'").get().total;
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
const output = 'verification/settings-installed';
try {
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.locator('.page-content > div')).toHaveCSS('opacity', '1');
  const categories = page.getByRole('navigation', { name: '设置分类' });
  await expect(categories.getByRole('button')).toHaveText(['本地图库', '高级设置', '关于']);
  await categories.getByRole('button', { name: '高级设置' }).click();
  await expect(page.getByRole('switch', { name: '自动轮换推荐' })).toHaveAttribute('aria-checked', String(settings.recommendationAutoRotate !== false));
  await expect(page.getByRole('combobox', { name: '推荐切换间隔' })).toHaveValue(String(settings.recommendationIntervalSeconds ?? 6));
  await expect(page.getByRole('combobox', { name: '推荐过渡速度' })).toHaveValue(String(settings.recommendationTransitionMs ?? 800));
  await expect(page.getByRole('switch', { name: '推荐悬停时暂停' })).toHaveAttribute('aria-checked', String(settings.recommendationPauseOnHover !== false));
  await expect(page.getByRole('switch', { name: '减少动态效果' })).toHaveAttribute('aria-checked', String(settings.reducedMotion));
  await expect(page.getByRole('combobox', { name: '视频封面取帧位置' })).toHaveValue(String(settings.videoPosterPercent ?? 10));
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/advanced.png`, fullPage: true });
  await categories.getByRole('button', { name: '本地图库' }).click();
  await expect(page.locator('.settings-library-summary strong')).toHaveText([albumTotal.toLocaleString(), mediaTotal.toLocaleString()]);
  await expect(page.getByRole('button', { name: '导出备份', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${output}/library.png` });
  await page.getByRole('button', { name: '重置本地图库', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('重置前会自动保存图库备份');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await categories.getByRole('button', { name: '关于' }).click();
  await expect(page.getByRole('region', { name: '关于', exact: true })).toContainText('即将上线');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${output}/about.png` });
  await categories.getByRole('button', { name: '高级设置' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('http://tauri.localhost'))).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(snapshot()).toBe(before);
  const result = { engine: 'installed Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry,
    embeddedSettings: true, categories: ['本地图库', '高级设置', '关于'], countsMatchCatalog: true, advancedPreferences: true,
    resetCancelled: true, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
  await browser.close();
}
