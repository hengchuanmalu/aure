import { connectNative, nativePage } from '../support/native-session.mjs';
// Native writes require the dedicated test identifier and disposable files.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const identifier = 'local.jingji.featured-layout-test';
const output = resolve('verification/featured-layout');
const browser = await connectNative('http://127.0.0.1:9248', identifier);
try {
  const page = nativePage(browser);
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe(identifier);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mkdir(output, { recursive: true });
  await invoke('catalog_reset', { seed: { version: 1, albums: [], media: [], models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: true }, importRules: [] } });
  await page.goto('http://tauri.localhost/#/');
  await expect(page.locator('.featured-grid')).toHaveCount(0);
  const db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
  const originalHashes = [];
  const measurements = [];
  async function check(count) {
    const grid = page.locator('.featured-grid');
    await expect(grid.locator('.album-card')).toHaveCount(count);
    await expect.poll(() => grid.locator('img').evaluateAll(images => images.every(i => i.complete && i.naturalHeight > 0))).toBe(true);
    await expect.poll(() => grid.evaluate(el => {
      const box = el.getBoundingClientRect();
      const next = document.querySelector('.people-section').getBoundingClientRect();
      return [...el.querySelectorAll('.album-card, .cover-link, img, .album-overlay')].every(child => {
        const rect = child.getBoundingClientRect();
        return rect.height > 0 && rect.bottom <= box.bottom + 1 && rect.bottom < next.top;
      });
    })).toBe(true);
    measurements.push(await grid.evaluate(el => ({ height: el.clientHeight, rows: getComputedStyle(el).gridTemplateRows, cardHeights: [...el.querySelectorAll('.album-card')].map(card => card.clientHeight) })));
  }
  try {
    for (let i = 0; i < 5; i++) {
      const directory = join(output, `disposable-set-${i}`);
      await mkdir(directory, { recursive: true });
      const sourcePath = join(directory, 'cover.jpg');
      await copyFile(resolve('tests/fixtures/media/p-1382731.jpg'), sourcePath);
      originalHashes.push([sourcePath, createHash('sha256').update(await readFile(sourcePath)).digest('hex')]);
      // Stand in for the native picker's file authorization, only in this test DB.
      db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(sourcePath.replaceAll('\\', '/').toLowerCase());
      const src = `http://jingji.localhost/media/layout-photo-${i}`;
      await invoke('catalog_operation', { op: {
        type: 'importPrepared',
        album: { id: `layout-set-${i}`, name: `Layout set ${i}`, cover: src, coverMediaId: `layout-photo-${i}`, sourceDirectory: directory, sourceFolderName: `set-${i}`, subtitle: '', description: '', mediaIds: [`layout-photo-${i}`], modelIds: [`layout-model-${i}`], tags: [], favorite: false, createdAt: '2026-10-06', updatedAt: '2026-10-06' },
        media: [{ id: `layout-photo-${i}`, src, sourcePath, name: 'cover.jpg', kind: 'image', width: 0, height: 0, size: (await stat(sourcePath)).size, tags: [], favorite: false, liked: false, rating: 0 }],
        models: [{ id: `layout-model-${i}`, name: `Layout model ${i}`, avatar: src, background: '', alias: '', bio: '', fields: [], links: [], photoIds: [] }], groups: [], tags: [], importRules: [],
      } });
      await page.reload();
      await check(i + 1);
      if (i < 2) await gridScreenshot(`first-${i + 1}`);
    }
    await page.goto('http://tauri.localhost/#/?model=layout-model-0');
    await check(1);
    await gridScreenshot('filtered-single');
    await page.reload();
    await check(1);
    for (const [path, hash] of originalHashes) expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(hash);
    expect(errors).toEqual([]);
    const report = { engine: 'Windows WebView2', identifier, nativeImportCommits: 5, pickerAuthorization: 'test fixture', filteredSingle: true, reload: true, originalsUnchanged: true, measurements, errors };
    await writeFile(join(output, 'native-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { db.close(); }
  async function gridScreenshot(name) { await page.locator('.featured-section').screenshot({ path: join(output, `${name}.png`) }); }
} finally { await browser.close(); }
