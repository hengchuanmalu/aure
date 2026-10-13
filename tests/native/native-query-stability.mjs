import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative('http://127.0.0.1:9255', 'local.jingji.desktop');
const page = nativePage(browser);
page.setDefaultTimeout(20000);
const originalHash = await page.evaluate(() => location.hash);
const errors = []; const checks = [];
page.on('pageerror', error => errors.push(error.message));
const output = 'verification/query-stability-installed';
await mkdir(output, { recursive: true });
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(r => ({ albumId: r.album, ...(r.media ? { mediaId: r.media } : {}), at: r.at }));
let guarded = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__stabilityFetch = original;
    window.__stabilityProbe = true;
    window.__stabilityReads = [];
    window.fetch = async (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_view' && window.__stabilityProbe) return new Response(JSON.stringify({ readProbe: true }), { headers });
        if (command === 'catalog_recent') return new Response(JSON.stringify(recent), { headers });
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command))
          return new Response(JSON.stringify('Read-only stability acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } });
        if (command === 'catalog_view') {
          const text = typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body);
          window.__stabilityReads.push(JSON.parse(text).query);
          await new Promise(resolve => setTimeout(resolve, 180));
        }
      }
      return original.call(window, input, options);
    };
  }, recent);
  const probe = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } }));
  expect(probe.readProbe).toBe(true); guarded = true;
  await page.evaluate(() => { window.__stabilityProbe = false; });
  const navigate = hash => page.evaluate(hash => { location.hash = hash; scrollTo(0, 0); }, hash);
  const settle = () => page.waitForFunction(() => !document.querySelector('#root > .loading') && !document.querySelector('.toast[role=alert]'));
  const remember = selector => page.evaluate(selector => {
    window.__held = document.querySelector(selector); window.__heldShell = document.querySelector('.topbar');
    window.__removed = false;
    window.__mountObserver = new MutationObserver(() => { window.__removed ||= !window.__held?.isConnected || !window.__heldShell?.isConnected || !!document.querySelector('#root > .loading'); });
    window.__mountObserver.observe(document.body, { childList: true, subtree: true });
  }, selector);
  const retained = async (name, selector) => {
    const state = await page.evaluate(selector => { window.__mountObserver.disconnect(); return { sameNode: window.__held === document.querySelector(selector), sameShell: window.__heldShell === document.querySelector('.topbar'), removed: window.__removed }; }, selector);
    expect(state.sameNode).toBe(true); expect(state.sameShell).toBe(true); expect(state.removed).toBe(false);
    checks.push({ name, ...state });
  };
  const models = db.prepare("SELECT e.id, e.name, count(r.owner) count FROM entities e JOIN refs r ON r.target=e.id AND r.target_kind='models' AND r.role='models' WHERE e.kind='models' GROUP BY e.id ORDER BY count(r.owner) ASC").all();
  const first = models[0], second = models.find(model => model.id !== first?.id && model.count > 48) || models.find(model => model.id !== first?.id && model.count !== first.count);
  if (!first || !second) throw Error('At least two real models with distinct album counts are required');
  await navigate('/library'); await page.locator('.album-grid .album-card').first().waitFor();
  for (const model of [first, second]) {
    await remember('.library-page');
    await page.locator('.model-filters .entity-chip').filter({ hasText: model.name }).click();
    await expect(page.locator('.library-results small')).toHaveText(`${model.count} 本`);
    await retained(`library-model-${model.id}`, '.library-page');
  }
  await expect.poll(() => page.locator('.album-grid .fan-front img').evaluateAll(images => images.slice(0, 4).every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: `${output}/library.png` });
  await remember('.album-grid'); await page.getByRole('button', { name: '排序', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '名称排序', exact: true }).click();
  await page.waitForTimeout(400); await retained('library-sort', '.album-grid'); await page.keyboard.press('Escape');
  await remember('.album-grid'); await page.locator('.topbar').getByRole('button', { name: '添加写真', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await retained('library-create-dialog', '.album-grid'); await page.keyboard.press('Escape');

  await navigate('/'); await page.locator('.discovery').waitFor(); await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__emptyFlash = false;
    window.__emptyObserver = new MutationObserver(() => {
      window.__emptyFlash ||= !!document.querySelector('.featured-section .empty');
    });
    window.__emptyObserver.observe(document.querySelector('.featured-section'), { childList: true, subtree: true });
  });
  await remember('.discovery'); await page.locator('.model-filters .entity-chip').filter({ hasText: first.name }).click();
  await expect(page.locator('.featured-section h2')).toHaveText(`${first.name}的写真`); await page.waitForTimeout(400); await retained('home-model', '.discovery');
  expect(await page.evaluate(() => { window.__emptyObserver.disconnect(); return window.__emptyFlash; })).toBe(false);
  await page.screenshot({ path: `${output}/home.png` });

  await navigate('/tags'); await page.locator('.tag-browse-page .album-card').first().waitFor();
  await remember('.tag-browse-page'); await page.locator('.tag-browse-chip').first().click();
  await page.waitForTimeout(500); await retained('tags-filter', '.tag-browse-page');

  const mixed = db.prepare('SELECT album,images,videos FROM summaries WHERE images>0 AND videos>0 ORDER BY images+videos ASC LIMIT 1').get();
  if (mixed) {
    await navigate(`/album/${mixed.album}`); await page.locator('.album-content-toolbar').waitFor(); await page.waitForTimeout(400);
    await remember('.album-content-toolbar'); await page.getByRole('button', { name: '照片', exact: true }).click();
    await expect(page.locator('.media-layout')).toHaveAttribute('data-total-items', String(Math.min(96, mixed.images)));
    await retained('album-kind-filter', '.album-content-toolbar'); await page.screenshot({ path: `${output}/album.png` });
  }

  const favorite = db.prepare("SELECT count(*) count FROM entities WHERE kind='media' AND favorite=1").get();
  if (favorite.count) {
    await navigate('/favorites?tab=media'); await page.locator('.media-card').first().waitFor(); await page.waitForTimeout(350);
    await remember('.media-grid');
    const previousReads = await page.evaluate(() => window.__stabilityReads.filter(q => q.route === 'favorites').length);
    await page.locator('.media-open').first().click(); await expect(page.locator('.viewer')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.viewer')).toHaveCount(0);
    await retained('favorites-viewer-return', '.media-grid');
    expect(await page.evaluate(() => window.__stabilityReads.filter(q => q.route === 'favorites').length)).toBe(previousReads);
  }

  const pickModel = models.find(model => model.count > 1);
  await navigate(`/models/${pickModel.id}`); await page.locator('.model-hero').waitFor(); await page.waitForTimeout(350);
  await page.locator('.topbar').getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '模特头像', exact: true }).click();
  await page.locator('.avatar-sources .avatar-source').nth(1).waitFor(); await page.locator('.avatar-photo-scroll').waitFor();
  await remember('.avatar-photo-scroll'); await page.locator('.avatar-sources .avatar-source').nth(1).click();
  await expect(page.locator('.avatar-photo-scroll')).toHaveAttribute('aria-busy', 'false');
  await retained('avatar-source', '.avatar-photo-scroll');
  await page.screenshot({ path: `${output}/avatar.png` }); await page.keyboard.press('Escape');
  await navigate(originalHash || '/'); await settle(); await page.waitForTimeout(500);
  expect(errors).toEqual([]); expect(catalogSnapshot(db)).toBe(before);
  expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
  const report = { receipt, checks, catalogUnchanged: true, integrity: 'ok', errors };
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (guarded) await page.evaluate(() => { window.fetch = window.__stabilityFetch; window.__mountObserver?.disconnect(); window.__emptyObserver?.disconnect(); }).catch(() => {});
  db.close(); await browser.close();
}

