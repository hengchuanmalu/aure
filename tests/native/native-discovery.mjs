import { readInstalledBuild, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance of the installed release. Never seed/reset the real catalog.
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const executableHash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const catalog = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const catalogHash = () => createHash('sha256').update(JSON.stringify({
  entities: catalog.prepare('SELECT * FROM entities ORDER BY kind,id').all(),
  refs: catalog.prepare('SELECT * FROM refs ORDER BY owner_kind,owner,role,position,target').all(),
  meta: catalog.prepare('SELECT * FROM meta ORDER BY key').all(),
  recent: catalog.prepare('SELECT * FROM recent ORDER BY album').all(),
  authorized: catalog.prepare('SELECT * FROM authorized ORDER BY path').all(),
})).digest('hex');
try {
  const page = nativePage(browser);
  if (!page) throw Error('Installed WebView2 page missing');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  await page.goto('http://tauri.localhost/#/');
  await expect(page.getByRole('heading', { name: '推荐', exact: true })).toBeVisible();
  await expect(page.getByText('在熟悉的收藏里，遇见新的心动。')).toHaveCount(0);
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const before = await invoke('catalog_view', { query: { route: 'home' } });
  const beforeHash = catalogHash();
  await expect(page.locator('.collection-note')).toContainText(`${before.albumTotal} 本写真集`);
  await expect(page.locator('.collection-note')).toContainText(`${before.modelTotal} 位模特`);
  const cards = page.locator('.featured-grid .album-card');
  await expect(cards).toHaveCount(Math.min(5, before.albumTotal));
  const covers = [];
  for (const card of await cards.all()) {
    const image = card.locator('.cover-link img');
    await expect(image).toHaveAttribute('src', /^http:\/\/jingji\.localhost\/thumbnail\//);
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(card.locator('.featured-caption small')).toHaveCSS('opacity', '0');
    const centerOffset = await card.evaluate(el => {
      const title = el.querySelector('.featured-caption h3').getBoundingClientRect();
      return [...el.querySelectorAll('.card-bottom .jj-button')].map(button => {
        const box = button.getBoundingClientRect();
        return Math.abs(title.y + title.height / 2 - box.y - box.height / 2);
      });
    });
    // The large title is raised for optical alignment; actions retain their row.
    const titleOffset = await card.locator('.featured-caption h3').evaluate(el => Math.abs(parseFloat(getComputedStyle(el).top) || 0));
    expect(centerOffset.every(offset => Math.abs(offset - titleOffset) <= 1)).toBe(true);
    const buttonInset = await card.evaluate(el => {
      const cardBox = el.getBoundingClientRect();
      const buttonBox = el.querySelector('.card-bottom .jj-button').getBoundingClientRect();
      return cardBox.bottom - buttonBox.bottom;
    });
    expect(Math.abs(buttonInset - 6)).toBeLessThanOrEqual(1);
    covers.push(await image.evaluate(img => ({ name: img.alt, width: img.naturalWidth, height: img.naturalHeight })));
  }
  await expect(page.locator('.featured-grid .photo-fallback')).toHaveCount(0);
  const output = 'verification/native-discovery';
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/default.png` });
  if (before.albumTotal) {
    const caption = cards.first().locator('.featured-caption');
    await caption.locator('h3').hover();
    await expect(caption.locator('small')).toHaveCSS('opacity', '1');
    await expect(caption.locator('h3')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -20)');
    await page.screenshot({ path: `${output}/hover.png` });
    await page.getByRole('heading', { name: '发现', exact: true }).hover();
    await expect(caption.locator('small')).toHaveCSS('opacity', '0');
  }
  // Foreground refresh must discard an obsolete window snapshot without writing data.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.collection-note')).toContainText(`${before.albumTotal} 本写真集`);
  const after = await invoke('catalog_view', { query: { route: 'home' } });
  expect([after.albumTotal, after.modelTotal, after.mediaCount]).toEqual([before.albumTotal, before.modelTotal, before.mediaCount]);
  expect(catalogHash()).toBe(beforeHash);
  expect(errors).toEqual([]);
  const report = { engine: 'Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry, albums: after.albumTotal, models: after.modelTotal, media: after.mediaCount, covers, captionHover: true, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { catalog.close(); await browser.close(); }
