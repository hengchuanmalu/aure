import { readInstalledBuild, catalogSnapshot, connectNative, nativePage, invokeNative } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9266', 'local.jingji.desktop');
const page = nativePage(browser);
page.setDefaultTimeout(20000);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const output = 'verification/search-installed';
await mkdir(output, { recursive: true });
const checks = [];
let guarded = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  expect(await page.getByRole('dialog').count()).toBe(0);
  await page.evaluate(recent => {
    window.__searchFetch = window.fetch;
    window.__searchProbe = true;
    const allowed = new Set(['catalog_view', 'catalog_suggestions', 'catalog_entity', 'catalog_candidates', 'catalog_model_albums', 'original_cover_revision']);
    window.fetch = async (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_suggestions' && window.__searchProbe) return new Response(JSON.stringify({ readProbe: true }), { headers });
        if (command === 'catalog_recent') return new Response(JSON.stringify(recent), { headers });
        if (command === 'catalog_sync_folders') return new Response(JSON.stringify({ changed: false, issues: 0 }), { headers });
        if (command.startsWith('catalog_') && !allowed.has(command)) return new Response(JSON.stringify('Read-only search acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } });
      }
      return window.__searchFetch.call(window, input, options);
    };
  }, recent);
  expect((await invokeNative(page, 'catalog_suggestions', { query: 'probe' })).readProbe).toBe(true);
  guarded = true;
  await page.evaluate(() => { window.__searchProbe = false; location.hash = '/library'; });
  const input = page.getByRole('combobox', { name: '搜索写真、模特或标签', exact: true });
  await expect(input).toBeVisible();
  const album = db.prepare("SELECT id,name FROM entities WHERE kind='albums' AND length(name) BETWEEN 1 AND 120 AND name IN (SELECT name FROM entities WHERE kind='albums' GROUP BY name HAVING count(*)=1) ORDER BY updated ASC,id LIMIT 1").get();
  const model = db.prepare("SELECT id,name FROM entities WHERE kind='models' AND length(name) BETWEEN 1 AND 120 ORDER BY id LIMIT 1").get();
  const tag = db.prepare("SELECT id,name FROM entities WHERE kind='tags' AND length(name) BETWEEN 1 AND 120 ORDER BY id LIMIT 1").get();
  if (!album) throw Error('A uniquely named album is required for installed search acceptance');
  const sample = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const results = await invokeNative(page, 'catalog_suggestions', { query: album.name });
    sample.push(performance.now() - start);
    expect(results.length).toBeLessThanOrEqual(8);
    expect(results.some(item => item.kind === 'album' && item.id === album.id)).toBe(true);
    expect(JSON.stringify(results).length).toBeLessThan(64000);
  }
  sample.sort((a, b) => a - b);
  checks.push({ name: 'full-catalog-query', bounded: true, searchP95Ms: sample.at(-1) });
  await input.fill(album.name);
  const panel = page.locator('.search-suggestions');
  const albumOption = panel.locator(`[data-value="album:${album.id}"]`);
  await expect(albumOption).toBeVisible();
  await expect(input).toBeFocused();
  await expect(panel).toHaveCSS('opacity', '1');
  await expect.poll(async () => (await panel.boundingBox())?.height || 0).toBeGreaterThan(50);
  const anchorBox = await page.locator('.catalog-search-anchor').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(Math.abs(anchorBox.width - panelBox.width)).toBeLessThan(2);
  expect(panelBox.y).toBeGreaterThanOrEqual(anchorBox.y + anchorBox.height);
  await expect.poll(() => panel.locator('.search-suggestion-image--album img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: `${output}/suggestions.png` });
  await albumOption.click();
  await expect(page).toHaveURL(new RegExp(`#/album/${album.id}$`));
  await expect(page.locator('h1')).toHaveText(album.name);
  checks.push({ name: 'album-result-and-thumbnail', passed: true });
  if (model) {
    await input.fill(model.name);
    const option = panel.locator(`[data-value="model:${model.id}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(new RegExp(`#/models/${model.id}$`));
    checks.push({ name: 'model-result', passed: true });
  }
  if (tag) {
    await input.fill(tag.name);
    const option = panel.locator(`[data-value="tag:${tag.id}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(new RegExp(`#/tags\\?tag=${tag.id}$`));
    checks.push({ name: 'tag-result', passed: true });
  }
  await input.fill('完全不存在的搜索验收内容');
  await expect(panel.locator('.search-message')).toHaveText('没有找到匹配的内容');
  await input.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(input).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.fill(album.name);
  await expect(albumOption).toBeVisible();
  expect(await panel.evaluate(element => getComputedStyle(element).animationDuration)).toBe('0s');
  expect(await panel.locator('[cmdk-list]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  checks.push({ name: 'empty-escape-and-reduced-motion', passed: true });
  await input.press('Escape');
  expect(errors).toEqual([]);
} finally {
  await page.emulateMedia({ reducedMotion: null });
  if (guarded) {
    await page.evaluate(hash => { location.hash = hash; }, originalHash);
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.fetch = window.__searchFetch; delete window.__searchFetch; delete window.__searchProbe; });
  }
  const after = catalogSnapshot(db);
  await writeFile(`${output}/validation.json`, JSON.stringify({ checks, errors, catalogUnchanged: before === after, frontendEntry: receipt.FrontendEntry }, null, 2));
  db.close();
  await browser.close();
  expect(after).toBe(before);
}
console.log(JSON.stringify({ checks, errors, catalogUnchanged: true }));
