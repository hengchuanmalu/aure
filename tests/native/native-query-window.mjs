// Installed acceptance is read-only; delayed/failing writes use browser fixtures.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild } from '../support/native-session.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const album = db.prepare('SELECT album, images+videos AS total FROM summaries ORDER BY total DESC LIMIT 1').get();
if (!album?.total) throw Error('Read-only acceptance needs an existing nonempty album');
const recent = db.prepare('SELECT album, media, at FROM recent ORDER BY at DESC').all()
  .map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const initialHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
let intercepted = false;
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(recent => {
    const original = window.fetch;
    window.__queryWindowFetch = original;
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
        if (command === 'catalog_recent') return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
        if (['catalog_patch', 'catalog_operation', 'catalog_reset', 'catalog_restore_recent'].includes(command)) {
          return Promise.resolve(new Response(JSON.stringify('Read-only query-window acceptance'), {
            headers: { ...headers, 'Tauri-Response': 'error' },
          }));
        }
      }
      return original.call(window, input, options);
    };
  }, recent);
  intercepted = true;
  const blocked = await invoke('catalog_patch', { changes: {} }).then(() => '', error => String(error));
  expect(blocked).toContain('Read-only query-window acceptance');
  const view = await invoke('catalog_view', { query: { route: 'album', id: album.album } });
  expect(view.db.albums[0].mediaIds).toEqual([]);
  expect(view.visibleMediaIds.length).toBeLessThanOrEqual(96);
  expect(view.firstMediaId).toBeTruthy();
  const entity = await invoke('catalog_entity', { kind: 'albums', id: album.album });
  expect(entity.mediaIds).toHaveLength(Number(album.total));
  expect(entity.mediaIds[0]).toBe(view.firstMediaId);
  await page.evaluate(id => { location.hash = `/album/${encodeURIComponent(id)}`; }, album.album);
  await expect(page.getByRole('heading', { name: entity.name, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = { engine: 'installed Release WebView2', executableHash: receipt.ExecutableHash,
    frontendEntry: receipt.FrontendEntry, total: Number(album.total), window: view.visibleMediaIds.length,
    displayRelationshipIds: view.db.albums[0].mediaIds.length, completeEditorRelationshipIds: entity.mediaIds.length,
    editorOpenedAndCancelled: true, mutationsBlocked: true, catalogUnchanged: true, errors };
  await mkdir('verification/query-window', { recursive: true });
  await writeFile('verification/query-window/installed.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (intercepted) {
    await page.evaluate(hash => { location.hash = hash; }, initialHash).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.fetch = window.__queryWindowFetch;
      delete window.__queryWindowFetch;
    }).catch(() => {});
  }
  db.close();
  await browser.close();
}
