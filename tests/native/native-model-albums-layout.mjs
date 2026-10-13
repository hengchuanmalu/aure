import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed WebView2 acceptance; production catalog remains read-only.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const model = db.prepare("SELECT target AS id, COUNT(*) AS total FROM refs WHERE owner_kind='albums' AND target_kind='models' GROUP BY target HAVING COUNT(*) >= 5 ORDER BY CASE WHEN COUNT(*)=8 THEN 0 ELSE 1 END, total DESC LIMIT 1").get();
if (!model || model.total < 5) throw Error('At least five linked albums are needed for installed multi-row acceptance');
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
try {
  const page = nativePage(browser);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.goto(`http://tauri.localhost/#/models/${model.id}`);
  const section = page.getByRole('region', { name: '关联写真集', exact: true });
  const cards = section.locator('.album-card');
  await expect(cards).toHaveCount(Math.min(model.total, 12));
  await expect(section.getByRole('heading', { level: 2 })).toHaveText(`关联写真集 · ${model.total}`);
  await expect(section.locator('.rail')).toHaveCount(0);
  await expect(section.getByRole('button', { name: /向[左右]滚动/ })).toHaveCount(0);
  expect(await section.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => cards.evaluateAll(items => new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size)).toBeGreaterThan(1);
  await cards.first().scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  const box = await cards.first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toBeInViewport();
  await section.getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded();
  await expect.poll(() => cards.locator('.fan-front img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await mkdir('verification/model-albums-installed', { recursive: true });
  await page.screenshot({ path: 'verification/model-albums-installed/layout.png', fullPage: true });
  await section.getByRole('link', { name: '查看全部', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/library\\?model=${model.id}$`));
  await expect(page.locator('.album-grid .album-card').first()).toBeVisible();
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  await page.goto(`http://tauri.localhost/#/models/${model.id}`);
  await page.getByRole('heading', { name: `关联写真集 · ${model.total}`, exact: true }).scrollIntoViewIfNeeded();
  const report = { engine: 'installed Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry,
    linkedAlbums: model.total, multipleRows: true, horizontalOverflow: false, wheelScrollsPageVertically: true,
    lastRowReachable: true, viewAllWorks: true, catalogUnchanged: true, errors };
  await writeFile('verification/model-albums-installed/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); await browser.close(); }
