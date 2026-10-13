import { readInstalledBuild, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only validation of the installed release; never seed the formal catalog.
import { expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const hash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9255', "local.jingji.desktop");
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const catalogHash = () => createHash('sha256').update(JSON.stringify({
  entities: db.prepare('SELECT * FROM entities ORDER BY kind,id').all(),
  refs: db.prepare('SELECT * FROM refs ORDER BY owner_kind,owner,role,position,target').all(),
  meta: db.prepare('SELECT * FROM meta ORDER BY key').all(),
  recent: db.prepare('SELECT * FROM recent ORDER BY album').all(),
  authorized: db.prepare('SELECT * FROM authorized ORDER BY path').all(),
})).digest('hex');
try {
  const page = nativePage(browser);
  if (!page) throw Error('Installed WebView2 missing');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://tauri.localhost/#/');
  await page.reload();
  await page.bringToFront();
  expect(await page.locator('script[type="module"]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const before = catalogHash();
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } }));
  const albums = snapshot.db.albums;
  const active = '.featured-grid[data-active="true"]';
  const titles = () => page.locator(`${active} h3`).allTextContents();
  const first = albums.slice(0, 5).map(album => album.name);
  await expect(page.locator('.recommendation-controls')).toHaveCount(0);
  await expect(page.locator('.featured-section > .section-title').getByRole('button', { name: '刷新推荐' })).toBeVisible();
  await expect(page.locator('.featured-section').getByText('全部写真', { exact: true })).toHaveCount(0);
  expect(await page.getByRole('button', { name: '刷新推荐' }).getAttribute('title')).toBeNull();
  await expect(page.locator(`${active} h3`)).toHaveText(first);
  await page.locator(`${active} .cover-link`).first().hover();
  await expect.poll(() => page.locator(`${active} img`).evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), { timeout: 20000 }).toBe(true);
  const bounds = await page.locator(active).boundingBox();
  let animation = null;
  await mkdir('verification/recommendations', { recursive: true });
  await page.screenshot({ path: 'verification/recommendations/installed-first.png' });
  if (albums.length > 1) {
    const step = albums.length > 5 ? 5 : 1;
    const expected = Array.from({ length: Math.min(5, albums.length) }, (_, index) => albums[(step + index) % albums.length].name);
    const second = Array.from({ length: Math.min(5, albums.length) }, (_, index) => albums[(2 * step + index) % albums.length].name);
    const third = Array.from({ length: Math.min(5, albums.length) }, (_, index) => albums[(3 * step + index) % albums.length].name);
    await page.evaluate(() => {
      window.__recommendationFrames = [];
      let started = false;
      const sample = time => {
        const frame = document.querySelector('.recommendation-carousel');
        if (frame.dataset.transitioning === 'true') {
          started = true;
          const incoming = frame.querySelector('[data-entering="true"]');
          window.__recommendationFrames.push({ time, opacity: Number(getComputedStyle(incoming).opacity), loaded: [...incoming.querySelectorAll('img')].filter(image => image.complete && image.naturalWidth > 0).length });
        } else if (started) return;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: '刷新推荐' }).click();
    await expect(page.locator(`${active} h3`)).toHaveText(expected, { timeout: 25000 });
    expect((await titles()).every((title, index) => title !== first[index])).toBe(true);
    expect(await page.locator(active).boundingBox()).toEqual(bounds);
    await expect.poll(() => page.locator(`${active} img`).evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(page.locator(`${active} .photo-fallback`)).toHaveCount(0);
    const frames = await page.evaluate(() => window.__recommendationFrames);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.some(frame => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
    expect(frames.every(frame => frame.loaded === first.length)).toBe(true);
    const gaps = frames.slice(1).map((frame, index) => frame.time - frames[index].time).sort((a, b) => a - b);
    animation = { frames: frames.length, frameGapP95Ms: gaps[Math.floor(gaps.length * 0.95)], everyCoverDecoded: true };
    await page.screenshot({ path: 'verification/recommendations/installed-next.png' });
    await page.getByRole('button', { name: '刷新推荐' }).click();
    await expect(page.locator(`${active} h3`)).toHaveText(second);
    await page.getByRole('button', { name: '刷新推荐' }).blur();
    await page.getByRole('heading', { name: '发现', exact: true }).hover();
    await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'false');
    await expect(page.locator(`${active} h3`)).toHaveText(third, { timeout: 12000 });
    await page.locator(`${active} .cover-link`).first().hover();
    await page.waitForTimeout(6500);
    expect(await titles()).toEqual(third);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('.recommendation-carousel')).toHaveAttribute('data-paused', 'true');
    await expect(page.locator(`${active} h3`)).toHaveText(first);
    await page.getByRole('button', { name: '刷新推荐' }).click();
    await expect(page.locator(`${active} h3`)).toHaveText(expected);
    expect(await page.locator(active).evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.getByRole('heading', { name: '发现', exact: true }).hover();
  }
  expect(catalogHash()).toBe(before);
  expect(errors).toEqual([]);
  const report = { engine: 'Windows WebView2', hash, frontendEntry: receipt.FrontendEntry, albums: snapshot.albumTotal, groupSize: first.length, manual: true, automatic: true, hoverPause: true, reducedMotion: true, animation, bounds, catalogUnchanged: true, errors };
  await writeFile('verification/recommendations/installed-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); await browser.close(); }
