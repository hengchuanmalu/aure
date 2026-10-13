import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed-release acceptance. Catalog writes, including automatic history, are
// answered in memory; the real SQLite catalog is read-only and compared afterward.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const executableHash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const target = db.prepare("SELECT owner id,count(*) count FROM refs WHERE owner_kind='albums' AND role='content' GROUP BY owner ORDER BY count(*) DESC LIMIT 1").get();
expect(target).toBeTruthy();
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const output = 'verification/media-views-native';
try {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const recent = await invoke('catalog_recent', { entry: null });
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__mediaViewsOriginalFetch = original;
    window.__mediaViewsBlockedHistory = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_recent') {
          window.__mediaViewsBlockedHistory++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_operation', 'catalog_patch', 'catalog_reset', 'catalog_restore_recent'].includes(command)) {
          headers['Tauri-Response'] = 'error';
          return Promise.resolve(new Response(JSON.stringify('Read-only gallery acceptance blocked a write'), { headers }));
        }
      }
      return original.call(window, input, options);
    };
  }, recent);
  const before = snapshot();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(id => { location.hash = `#/album/${encodeURIComponent(id)}`; }, target.id);
  const grid = page.locator('.media-layout');
  await expect(grid).toHaveAttribute('data-total-items', String(Math.min(target.count, 96)));
  const slider = page.getByRole('slider', { name: '每行照片数' });
  await expect(page.getByRole('button', { name: '批量选择', exact: true })).toHaveCount(0);
  await expect(page.locator('.media-column-control')).toHaveText('');
  await expect(page.locator('.picker-pages')).toHaveCount(0);
  await expect(page.locator('.album-media-pager')).toHaveCount(0);
  for (const label of ['瀑布流', '平铺', '自适应']) {
    const button = page.getByRole('button', { name: `${label}视图`, exact: true });
    await expect(button).toHaveText('');
    await page.mouse.move(0, 0);
    await button.hover();
    await expect(page.locator('.media-view-hint')).toBeVisible();
    await expect(page.getByRole('tooltip')).toContainText(label);
  }
  await slider.focus(); await slider.press('Home');
  for (let i = 0; i < 4; i++) await slider.press('ArrowRight');
  await expect(slider).toHaveValue('5');
  await page.setViewportSize({ width: 1440, height: 960 });
  await mkdir(output, { recursive: true });
  const modes = [];
  for (const [mode, label] of [['masonry', '瀑布流'], ['tiles', '平铺'], ['adaptive', '自适应']]) {
    await page.getByRole('button', { name: `${label}视图`, exact: true }).click();
    await expect(grid).toHaveAttribute('data-layout-mode', mode);
    const item = grid.locator('.media-layout-item').filter({ has: page.locator('img') }).first();
    await expect.poll(() => item.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(async () => {
      const box = await item.boundingBox();
      const aspect = mode === 'tiles' ? 1 : await item.locator('img').evaluate(image => image.naturalWidth / image.naturalHeight);
      return Math.abs(box.width / box.height - aspect);
    }).toBeLessThan(0.015);
    const mounted = await grid.locator('.media-card').count();
    if (target.count > 48) expect(mounted).toBeLessThan(target.count);
    await page.evaluate(() => {
      const toolbar = document.querySelector('.album-content-toolbar');
      window.scrollTo(0, toolbar.getBoundingClientRect().top + window.scrollY - 80);
    });
    await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.media-layout-item img'))
      .filter(image => { const box = image.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; })
      .every(image => image.complete && image.naturalWidth > 0)), { timeout: 15000 }).toBe(true);
    await page.screenshot({ path: `${output}/${mode}-1440.png` });
    modes.push({ mode, mounted, total: Number(await grid.getAttribute('data-total-items')), realThumbnailRatio: true });
    const loaded = Number(await grid.getAttribute('data-total-items'));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (loaded < target.count) await expect.poll(async () => Number(await grid.getAttribute('data-total-items'))).toBeGreaterThan(loaded);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  let continuousLoading = false;
  if (target.count > 96) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Number(await grid.getAttribute('data-total-items'))).toBeGreaterThan(96);
    await expect(grid).toHaveAttribute('data-layout-mode', 'adaptive');
    await expect(slider).toHaveValue('5');
    await expect(page.getByRole('navigation', { name: '图库分页' })).toHaveCount(0);
    continuousLoading = true;
  }
  for (const width of [1024, 800]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const blockedHistory = await page.evaluate(() => window.__mediaViewsBlockedHistory);
  expect(blockedHistory).toBeGreaterThan(0);
  expect(snapshot()).toBe(before); expect(errors).toEqual([]);
  const report = { engine: 'Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry, modes,
    widths: [1440, 1024, 800], iconOnlyViews: true, hoverHints: true, batchEntryRemoved: true,
    continuousLoading, blockedHistory, catalogIncludingHistoryUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => {
    if (window.__mediaViewsOriginalFetch) window.fetch = window.__mediaViewsOriginalFetch;
    delete window.__mediaViewsOriginalFetch; delete window.__mediaViewsBlockedHistory;
  }).catch(() => {});
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.clearDeviceMetricsOverride'); await session.detach();
  db.close(); await browser.close();
}
