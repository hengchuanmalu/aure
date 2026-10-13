import { readInstalledBuild, catalogSnapshot, connectNative, nativePage, installReadOnlyGuard } from '../support/native-session.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const recent = db.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({
  albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at,
}));
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
let cleanup, failure, cleanupFailure, before, after, home, acceptanceStartedAt, finalRoute;
let guardRemoved = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  cleanup = await installReadOnlyGuard(page, recent);
  before = catalogSnapshot(db);
  acceptanceStartedAt = new Date().toISOString();
  home = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } }));
  const album = home.db.albums[0];
  const queries = [{ route: 'home' }, { route: 'library' }, { route: 'library', q: '写真' },
    { route: 'favorites', tab: 'media' }, { route: 'settings' }];
  if (album) queries.push({ route: 'album', id: album.id });
  for (const query of queries) {
    results.push(await page.evaluate(async query => {
      const samples = []; let bytes = 0;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const result = await window.__TAURI_INTERNALS__.invoke('catalog_view', { query });
        samples.push(performance.now() - start);
        bytes = new TextEncoder().encode(JSON.stringify(result)).length;
      }
      samples.sort((a, b) => a - b);
      return { query, p50Ms: samples[9], p95Ms: samples[18], maxMs: samples[19], payloadBytes: bytes };
    }, query));
  }
  expect(catalogSnapshot(db)).toBe(before);
} catch (error) { failure = error; }
finally {
  try {
    if (cleanup) { await cleanup(); guardRemoved = true; }
    finalRoute = await page.evaluate(() => location.hash);
    after = catalogSnapshot(db);
    if (before) expect(after).toBe(before);
    expect(errors).toEqual([]);
  } catch (error) { cleanupFailure = error; }
  finally { db.close(); await browser.close(); }
}
const report = { engine: 'installed Release WebView2',
  measured: 'warm catalog IPC including serialization and read-only transport tracking; 20 samples per route',
  executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry,
  albums: home?.albumTotal, media: home?.mediaCount, results, errors,
  acceptanceStartedAt, acceptanceCompletedAt: new Date().toISOString(),
  catalogUnchanged: guardRemoved && !!before && after === before, snapshotComparedAfterGuardRemoval: guardRemoved && !!after,
  finalRoute, failure: failure?.stack, cleanupFailure: cleanupFailure?.stack };
const output = 'verification/release-performance';
await mkdir(output, { recursive: true });
await writeFile(`${output}/${process.env.AURE_PERF_PHASE || 'after'}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failure || cleanupFailure) throw failure || cleanupFailure;
