// Release smoke against the user's installed app: no fixture seeding or writes.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { release, arch } from 'node:os';
import { catalogSnapshot, connectNative, nativePage,
  readInstalledBuild, installReadOnlyGuard } from '../support/native-session.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({
  albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at,
}));
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const original = await page.evaluate(() =>
  Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = resolve('verification/native-release');
await mkdir(output, { recursive: true });
let cleanup, failure, cleanupFailure, engine, before, after, acceptanceStartedAt, finalRoute;
let guardRemoved = false;
const checks = [];
try {
  expect(await page.locator('script[type="module"]').getAttribute('src')).toBe(receipt.FrontendEntry);
  cleanup = await installReadOnlyGuard(page, recent);
  before = catalogSnapshot(db);
  acceptanceStartedAt = new Date().toISOString();
  const session = await page.context().newCDPSession(page);
  engine = await session.send('Browser.getVersion');
  await session.detach();
  for (const [route, title] of [['/','发现'], ['/library','写真库'], ['/models','模特'],
    ['/tags','标签'], ['/tags/manage','标签'], ['/favorites','收藏'], ['/recent','最近浏览'], ['/settings','设置']]) {
    await page.goto(`http://tauri.localhost/#${route}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(title);
    expect(await page.evaluate(() => !!window.__aureReadOnlyGuard)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('navigation', { name: '图库分页' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(上一页|下一页)$/ })).toHaveCount(0);
    checks.push({ route, firstRender: true, noHorizontalOverflow: true, noPaginationBar: true });
  }
  const album = db.prepare("SELECT album AS id FROM summaries WHERE images>0 ORDER BY rowid LIMIT 1").get();
  if (album) {
    await page.goto(`http://tauri.localhost/#/album/${encodeURIComponent(album.id)}`);
    await expect(page.locator('.album-hero')).toBeVisible();
    const firstImage = page.locator('.media-layout .media-card img').first();
    await expect(firstImage).toBeVisible();
    await expect.poll(() => firstImage.evaluate(image => image.complete && image.naturalWidth > 0), { timeout: 30000 }).toBe(true);
    expect(await page.evaluate(() => window.__aureReadOnlyGuard.history)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator('.album-hero')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__aureReadOnlyGuard.history)).toBeGreaterThan(0);
    const blocked = await page.evaluate(async () => {
      try { await window.__TAURI_INTERNALS__.invoke('catalog_reset', { seed: {} }); return ''; }
      catch (error) { return String(error); }
    });
    expect(blocked).toContain('Read-only release acceptance blocked');
    checks.push({ route: 'album', realThumbnailDecode: true, historyInterceptedAcrossReload: true });
  } else checks.push({ route: 'album', skipped: 'No album with images in the existing catalog' });
  expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
} catch (error) { failure = error; }
finally {
  try {
    await page.evaluate(original => {
      for (const key of Object.keys(localStorage)) if (!(key in original)) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(original)) localStorage.setItem(key, value);
    }, original);
    if (cleanup) { await cleanup(); guardRemoved = true; }
    finalRoute = await page.evaluate(() => location.hash);
    after = catalogSnapshot(db);
    if (before) expect(after).toBe(before);
    expect(errors).toEqual([]);
  } catch (error) { cleanupFailure = error; }
  finally {
    db.close();
    await browser.close();
  }
}
const report = { receipt, engine, platform: { release: release(), arch: arch() }, checks,
  acceptanceStartedAt, acceptanceCompletedAt: new Date().toISOString(),
  catalogUnchanged: guardRemoved && !!before && after === before, snapshotComparedAfterGuardRemoval: guardRemoved && !!after,
  finalRoute, integrity: failure ? undefined : 'ok', foreignKeys: failure ? undefined : 'ok',
  errors, failure: failure?.stack, cleanupFailure: cleanupFailure?.stack };
await writeFile(join(output, 'installed-smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failure || cleanupFailure) throw failure || cleanupFailure;
