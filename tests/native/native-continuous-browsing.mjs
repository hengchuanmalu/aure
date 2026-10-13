import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only installed WebView2 acceptance. Intercept history at the fetch layer;
// Tauri freezes its invoke function. Verify interception with a read first.
import { expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(root);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'json');
const before = snapshot();
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
page.setDefaultTimeout(10000);
let intercepted = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__albumFilterOriginalFetch = original;
    window.__albumFilterReadProbe = true; window.__continuousReads = [];
    window.__albumFilterHistoryBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        if (command === 'catalog_view' && !window.__albumFilterReadProbe) {
          try {
            const body = typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body);
            window.__continuousReads.push(JSON.parse(body).query);
          } catch { window.__continuousReads.push({ route: 'unknown' }); }
        }
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__albumFilterReadProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
        if (command === 'catalog_recent') {
          window.__albumFilterHistoryBlocked++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  const probe = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } }));
  expect(probe.readProbe).toBe(true);
  intercepted = true;
  await page.evaluate(() => { window.__albumFilterReadProbe = false; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const total = db.prepare("SELECT count(*) AS total FROM entities WHERE kind='albums'").get().total;
  const model = db.prepare("SELECT target AS id, count(*) AS total FROM refs WHERE owner_kind='albums' AND target_kind='models' GROUP BY target ORDER BY total DESC LIMIT 1").get();
  const album = db.prepare('SELECT album AS id, images + videos AS total, images, videos FROM summaries WHERE images > 0 ORDER BY images + videos DESC LIMIT 1').get();
  const navigate = hash => page.evaluate(hash => { location.hash = hash; }, hash);
  const reachEnd = async (selector, expected) => {
    for (let i = 0; i < 40; i++) {
      if (Number(await page.locator(selector).getAttribute('data-total-items')) === expected) break;
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
    }
    await expect(page.locator(selector)).toHaveAttribute('data-total-items', String(expected));
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  };
  await navigate('/library');
  await expect(page.getByRole('heading', { name: '写真库', exact: true })).toBeVisible();
  await reachEnd('.virtual-grid', total);
  await expect(page.locator('.catalog-pager')).toHaveCount(0);
  const menuCard = page.locator('.album-card').last();
  await menuCard.scrollIntoViewIfNeeded();
  const menuButton = menuCard.getByRole('button', { name: /更多操作/ });
  await menuCard.hover();
  await menuButton.hover();
  const menuBefore = await menuButton.boundingBox();
  await menuButton.click();
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  await expect(page.getByRole('menu')).toBeVisible();
  const menuAfter = await menuButton.boundingBox();
  expect(menuAfter.x).toBeCloseTo(menuBefore.x, 0); expect(menuAfter.y).toBeCloseTo(menuBefore.y, 0);
  await page.keyboard.press('Escape');
  await navigate(`/models/${model.id}`);
  await expect(page.getByRole('region', { name: '关联写真集', exact: true })).toBeVisible();
  if (model.total > 48) await reachEnd('.virtual-grid', model.total);
  else await expect(page.locator('.album-grid .album-card')).toHaveCount(model.total);
  await expect(page.getByRole('link', { name: '查看全部', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看头像大图' }).scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.profile-avatar img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const formalAvatarWidth = await page.locator('.profile-avatar img').evaluate(img => img.naturalWidth);
  expect(formalAvatarWidth).toBeGreaterThan(512);
  await page.getByRole('button', { name: '查看头像大图' }).click();
  await expect.poll(() => page.locator('.image-lightbox img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const avatarOriginalWidth = await page.locator('.image-lightbox img').evaluate(img => img.naturalWidth);
  await page.keyboard.press('Escape');
  await navigate(`/album/${album.id}`);
  await expect(page.locator('.media-layout')).toBeVisible();
  await reachEnd('.media-layout', album.total);
  await expect(page.locator('.catalog-pager')).toHaveCount(0);
  const photo = page.locator('.media-card:not(:has(.video-badge)) .media-open').last();
  await photo.scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__savedGrid = document.querySelector('.media-layout'); window.__savedY = scrollY;
    window.__readsBeforeViewer = window.__continuousReads.filter(q => q.route === 'album').length;
    document.addEventListener('pointerdown', () => { window.__savedY = scrollY; }, { once: true, capture: true }); });
  await photo.click();
  await expect(page.locator('.viewer')).toBeVisible();
  await expect.poll(() => page.locator('.media-stage > img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.locator('.media-stage').hover(); await page.mouse.wheel(0, 100);
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  const retained = await page.evaluate(() => ({ sameNode: window.__savedGrid === document.querySelector('.media-layout'), scrollDelta: scrollY - window.__savedY,
    albumReadsBefore: window.__readsBeforeViewer, albumReadsAfter: window.__continuousReads.filter(q => q.route === 'album').length }));
  expect(retained.sameNode).toBe(true); expect(Math.abs(retained.scrollDelta)).toBeLessThan(1); expect(retained.albumReadsAfter).toBe(retained.albumReadsBefore);
  await page.getByRole('button', { name: '查看封面大图' }).click();
  await expect.poll(() => page.locator('.image-lightbox img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const coverOriginalWidth = await page.locator('.image-lightbox img').evaluate(img => img.naturalWidth);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  await picker.locator('.cover-stage').hover({ position: { x: 20, y: (await picker.locator('.cover-stage').boundingBox()).height * .7 } });
  await expect(picker.locator('.cover-thumbnail').first()).toBeVisible();
  await picker.getByRole('group', { name: '封面照片', exact: true }).press('End');
  await expect(picker.getByRole('button', { name: `封面 素材 ${album.images}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await navigate('/models');
  const zone = page.locator('.model-index-zone');
  await zone.hover();
  const letters = page.locator('.model-index button:not(:disabled)');
  const firstLetter = await letters.nth(0).textContent();
  const secondLetter = await letters.nth(1).textContent();
  await letters.nth(0).click();
  await page.mouse.wheel(0, 100);
  await expect(letters.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(160); await page.mouse.wheel(0, -100);
  await expect(letters.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await navigate('/settings');
  await page.getByRole('button', { name: '高级设置', exact: true }).click();
  const navBefore = await page.locator('.settings-nav').boundingBox();
  await page.locator('.settings-content').hover(); await page.mouse.wheel(0, 800);
  await expect.poll(() => page.locator('.settings-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.settings-nav').boundingBox()).toEqual(navBefore);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: '关于', exact: true }).click();
  await expect(page.locator('.settings-content')).toContainText('当前版本号');
  await expect(page.locator('.settings-content')).toContainText('版本时间');
  await expect(page.locator('.settings-content')).toContainText('即将上线');
  await expect(page.getByText('运行环境', { exact: true })).toHaveCount(0);
  await mkdir('verification/continuous-installed', { recursive: true });
  await page.screenshot({ path: 'verification/continuous-installed/about.png' });
  expect(snapshot()).toBe(before); expect(errors).toEqual([]);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, libraryTotal: total, modelAlbums: model.total, albumMedia: album.total,
    retained, menuStable: true, formalAvatarWidth, avatarOriginalWidth, coverOriginalWidth, letterWheel: [firstLetter, secondLetter, firstLetter], coverSelectorReused: true, settingsNavigationFixed: true, aboutUpdated: true, catalogUnchanged: true, errors };
  await writeFile('verification/continuous-installed/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.evaluate(() => { location.hash = '/settings'; }).catch(() => {});
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor().catch(() => {});
  await page.evaluate(() => { if (window.__albumFilterOriginalFetch) { window.fetch = window.__albumFilterOriginalFetch; delete window.__albumFilterOriginalFetch; } }).catch(() => {});
  db.close(); await browser.close();
}
