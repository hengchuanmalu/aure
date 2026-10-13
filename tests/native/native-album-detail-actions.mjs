import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Verify the installed UI without committing edits or history to the production catalog.
import { expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(root);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'json');
const before = snapshot();
const row = db.prepare("SELECT data FROM entities WHERE kind='albums' ORDER BY (name='月光猫骑士') DESC LIMIT 1").get();
if (!row) throw Error('No album available for installed acceptance');
const album = JSON.parse(row.data);
const first = db.prepare("SELECT e.id FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY (e.media_kind='video'),r.position LIMIT 1").get(album.id);
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
page.setDefaultTimeout(10000);
let protectedHistory = false;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__actionsOriginalFetch = original;
    window.__actionsProbe = true;
    window.__actionsHistoryBlocked = 0;
    window.fetch = (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__actionsProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
        if (command === 'catalog_recent') {
          window.__actionsHistoryBlocked++;
          return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        }
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
      }
      return original.call(window, input, options);
    };
  }, recent);
  expect((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: {} }))).readProbe).toBe(true);
  protectedHistory = true;
  await page.evaluate(() => { window.__actionsProbe = false; });
  await page.evaluate(id => { location.hash = `/album/${id}`; }, album.id);
  const edit = page.locator('.topbar').getByRole('button', { name: '编辑写真集', exact: true });
  await expect(edit).toBeEnabled();
  await expect(page.getByRole('button', { name: '编辑写真集', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '创建写真集', exact: true })).toHaveCount(0);
  await expect(page.locator('.album-hero-actions button')).toHaveCount(0);
  await expect(page.locator('.album-browse-layer button')).toHaveCount(1);
  await expect(page.locator('.album-hero')).toHaveAttribute('data-cover-layout', 'landscape');
  await expect(page.locator('.album-cover-favorite')).toHaveAttribute('aria-pressed', String(album.favorite));
  const favorite = page.locator('.album-cover-favorite');
  await expect(favorite).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(favorite).toHaveCSS('box-shadow', 'none');
  await favorite.hover();
  await expect(favorite).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.2)');
  expect(await favorite.getAttribute('title')).toBeNull();
  await page.mouse.move(1000, 100);
  await expect(favorite).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(() => page.locator('.album-hero-cover img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const browse = page.getByRole('button', { name: '浏览写真', exact: true });
  await expect(browse).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(browse).toHaveCSS('color', 'rgb(23, 25, 28)');
  await expect(page.getByRole('button', { name: '重新扫描', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新定位文件夹', exact: true })).toHaveCount(0);
  const tone = await browse.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }));
  const deletion = await page.locator('.album-backline .album-remove').boundingBox();
  expect(deletion.y + deletion.height).toBeLessThan((await page.locator('.album-hero').boundingBox()).y);
  await page.evaluate(() => scrollTo(0, 0));
  const canScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 300);
  if (canScroll) {
    const hero = await page.locator('.album-hero').boundingBox();
    await page.mouse.move(hero.x + hero.width * 0.7, hero.y + 60);
    await page.mouse.wheel(0, 180);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(160);
    await page.evaluate(() => scrollTo(0, 0));
  }
  const geometry = await page.locator('.album-hero').evaluate(element => {
    const box = selector => element.querySelector(selector).getBoundingClientRect();
    const cover = box('.album-hero-cover'), favorite = box('.album-cover-favorite');
    const hero = element.getBoundingClientRect();
    const copy = box('.album-hero-copy'), actions = box('.album-hero-actions');
    const style = getComputedStyle(element);
    return { favoriteTop: favorite.top - cover.top, favoriteRight: cover.right - favorite.right, actionsRight: hero.right - actions.right, actionsBottom: hero.bottom - actions.bottom, paddingRight: parseFloat(style.paddingRight), paddingBottom: parseFloat(style.paddingBottom), coverWidth: cover.width - hero.width, coverHeight: cover.height - hero.height, separate: actions.left >= copy.right || actions.top >= copy.bottom };
  });
  expect(geometry.favoriteTop).toBeCloseTo(16, 0);
  expect(geometry.favoriteRight).toBeCloseTo(16, 0);
  expect(geometry.actionsRight).toBeCloseTo(geometry.paddingRight, 0);
  expect(geometry.actionsBottom).toBeCloseTo(geometry.paddingBottom, 0);
  expect(Math.abs(geometry.coverWidth)).toBeLessThan(1);
  expect(Math.abs(geometry.coverHeight)).toBeLessThan(1);
  expect(geometry.separate).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('verification/album-detail-actions', { recursive: true });
  await page.screenshot({ path: 'verification/album-detail-actions/installed.png' });
  await mkdir('verification/cover-experience', { recursive: true });
  await mkdir('verification/album-magnet', { recursive: true });
  await page.screenshot({ path: 'verification/album-magnet/installed-cover.png' });
  let docking;
  if (canScroll) {
    const near = gap => page.evaluate(gap => {
      const origin = document.querySelector('.album-browse-origin').getBoundingClientRect();
      const edit = document.querySelector('.topbar-action-group > button').getBoundingClientRect();
      const header = document.querySelector('.topbar').getBoundingClientRect();
      scrollTo(0, origin.top + scrollY - (edit.bottom - header.top + gap));
    }, gap);
    const handoff = () => page.evaluate(() => {
      const header = document.querySelector('.topbar').getBoundingClientRect();
      const cover = document.querySelector('.album-hero').getBoundingClientRect();
      const content = document.querySelector('.album-content-toolbar').getBoundingClientRect();
      return { cover: cover.bottom - header.bottom, content: content.top - header.bottom };
    });
    expect(await browse.evaluate(element => Math.abs(element.getBoundingClientRect().left - document.querySelector('.topbar-action-group > button').getBoundingClientRect().left))).toBeLessThan(1);
    await near(20);
    await page.waitForTimeout(100);
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await page.evaluate(() => {
      window.__magnetFrames = []; window.__recordMagnet = true;
      const sample = () => { window.__magnetFrames.push(scrollY); if (window.__recordMagnet) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    });
    await near(6);
    await expect(browse).toHaveAttribute('data-docked', 'true');
    await expect.poll(async () => Math.abs((await handoff()).content)).toBeLessThan(1);
    expect((await handoff()).cover).toBeLessThanOrEqual(0);
    const frames = await page.evaluate(() => { window.__recordMagnet = false; return window.__magnetFrames; });
    expect(new Set(frames.map(Math.round)).size).toBeGreaterThan(2);
    const contactHandoff = await handoff();
    await page.screenshot({ path: 'verification/album-magnet/installed-contact-handoff.png' });
    await page.evaluate(() => scrollTo(0, 0));
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await near(20);
    await near(6);
    await expect(browse).toHaveAttribute('data-docked', 'true');
    const interruptedAt = await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -360 }));
      return scrollY;
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(interruptedAt);
    await page.mouse.move(700, 350);
    await page.mouse.wheel(0, -360);
    await expect(browse).toHaveAttribute('data-docked', 'false');
    expect((await handoff()).content).toBeGreaterThan(40);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await page.evaluate(() => { window.__magnetBrowse = document.querySelector('.album-browse'); scrollTo(0, 650); });
    await expect(browse).toHaveAttribute('data-docked', 'true');
    const dockGeometry = () => browse.evaluate(element => {
      const button = element.getBoundingClientRect(), edit = document.querySelector('.topbar-action-group > button').getBoundingClientRect();
      return { gap: Math.abs(edit.left - button.left), center: Math.abs(button.top + button.height / 2 - edit.top - edit.height / 2), sameNode: element === window.__magnetBrowse };
    });
    await expect.poll(async () => (await dockGeometry()).gap).toBeLessThan(1);
    await expect.poll(async () => (await dockGeometry()).center).toBeLessThan(1);
    docking = { ...await dockGeometry(), contactHandoff, animatedScrollPositions: new Set(frames.map(Math.round)).size, gap20RemainsFree: true, gap6Catches: true, interruptedScrollStops: true };
    expect(docking.sameNode).toBe(true);
    await page.screenshot({ path: 'verification/album-magnet/installed-docked.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await page.evaluate(() => scrollTo(0, 0));
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await expect.poll(() => browse.evaluate(element => Math.abs(element.getBoundingClientRect().top - document.querySelector('.album-browse-origin').getBoundingClientRect().top))).toBeLessThan(1);
    await near(20);
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await near(6);
    await expect(browse).toHaveAttribute('data-docked', 'true');
    await expect.poll(async () => Math.abs((await handoff()).content)).toBeLessThan(1);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(browse).toHaveAttribute('data-docked', 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  await favorite.hover();
  await expect(favorite).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.2)');
  await page.screenshot({ path: 'verification/album-detail-actions/installed-favorite-hover.png' });
  await page.mouse.move(1000, 100);
  await page.locator('.album-cover-trigger').click({ position: { x: 120, y: 60 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '移出图库', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('不删除磁盘素材');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await edit.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue(album.name);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/album/${album.id}$`));
  if (first) {
    if (canScroll) {
      await page.evaluate(() => scrollTo(0, 650));
      await expect(browse).toHaveAttribute('data-docked', 'true');
    }
    await page.getByRole('button', { name: '浏览写真', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viewer/${album.id}/${first.id}$`));
    await expect(page.locator('.viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.viewer')).toHaveCount(0);
    await expect.poll(() => page.locator('.album-browse').evaluate(element => !!element.closest('[inert]'))).toBe(false);
    await expect(page.locator('.album-hero')).toBeVisible();
    await page.mouse.move(700, 350);
    await page.mouse.wheel(0, -2000);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(browse).toHaveAttribute('data-docked', 'false');
  }
  expect(await page.evaluate(() => window.__actionsHistoryBlocked)).toBeGreaterThan(0);
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, geometry, tone, docking, deletionAboveCover: true, nativeScrolling: canScroll, maintenanceButtonsRemoved: true, favoriteHover: 'white 20%', favoriteNativeTooltip: false, editAndCancel: true, browseEntry: !!first, catalogUnchanged: true, errors };
  await writeFile('verification/album-detail-actions/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (protectedHistory) {
    await page.evaluate(id => { location.hash = `/album/${id}`; scrollTo(0, 0); }, album.id).catch(() => {});
    await page.locator('.album-hero').waitFor().catch(() => {});
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});
  await page.evaluate(() => { window.__recordMagnet = false; delete window.__magnetFrames; delete window.__magnetBrowse; if (window.__actionsOriginalFetch) { window.fetch = window.__actionsOriginalFetch; delete window.__actionsOriginalFetch; delete window.__actionsProbe; delete window.__actionsHistoryBlocked; } }).catch(() => {});
  db.close();
  await browser.close();
}
