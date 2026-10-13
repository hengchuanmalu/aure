import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readBuildReceipt } from '../../scripts/check-installed.mjs';
export { readInstalledBuild } from '../../scripts/check-installed.mjs';

const tables = [
  "entities",
  "refs",
  "summaries",
  "recent",
  "authorized",
  "meta",
];
export const installedRoot = () =>
  join(process.env.LOCALAPPDATA, "Programs", "aure");

export function nativePage(browser) {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith("http://tauri.localhost"));
  if (!page) throw Error("Windows WebView2 page unavailable");
  return page;
}

export function invokeNative(page, command, args) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
}

export function isolatedIdentifier(fallback) {
  const identifier = process.env.AURE_NATIVE_IDENTIFIER || fallback;
  if (!/^local\.(?:jingji|aure)\.[a-z0-9-]+$/.test(identifier || '') || identifier === 'local.jingji.desktop')
    throw Error('写入验收必须使用独立的测试 identifier，拒绝正式图库。');
  return identifier;
}

export async function readIsolatedBuild(identifier) {
  if (identifier === 'local.jingji.desktop') throw Error('隔离构建不能使用正式 identifier。');
  const executable = process.env.AURE_NATIVE_EXE;
  if (!executable) throw Error('请设置 AURE_NATIVE_EXE，指向本次带构建收据的隔离 Release 程序。');
  return readBuildReceipt(executable, identifier);
}

// Use this only for installed read-only acceptance. The application writes
// history on navigation and may synchronize folders on focus. Intercept the
// complete transport before reload and reject unknown commands by default.
export async function installReadOnlyGuard(page, recent) {
  function guard(recent) {
    if (window.__aureReadOnlyGuard) return;
    const originalFetch = window.fetch;
    const reads = new Set(['catalog_initialize', 'catalog_view', 'catalog_suggestions',
      'catalog_entity', 'catalog_candidates', 'catalog_import_context', 'catalog_model_albums',
      'original_cover_revision', 'image_thumbnail', 'prepare_video', 'cancel_video',
      'plugin:app|identifier', 'plugin:app|version', 'plugin:app|name',
      'plugin:window|is_fullscreen', 'plugin:window|is_maximized', 'plugin:window|is_focused',
      'plugin:window|inner_size', 'plugin:window|scale_factor',
      'plugin:event|listen', 'plugin:event|unlisten']);
    const state = window.__aureReadOnlyGuard = { originalFetch, blocked: [], history: 0,
      pendingReads: 0, pendingInvokes: 0, completedHomeReads: 0 };
    const attachInvoke = () => {
      const bridge = window.__TAURI_INTERNALS__;
      if (state.bridge || !bridge?.invoke) return;
      state.bridge = bridge;
      state.originalInvoke = bridge.invoke;
      state.invoke = (command, args, ...rest) => {
        state.pendingInvokes++;
        try {
          return Promise.resolve(state.originalInvoke.call(bridge, command, args, ...rest))
            .finally(() => state.pendingInvokes--);
        } catch (error) { state.pendingInvokes--; throw error; }
      };
      bridge.invoke = state.invoke;
    };
    attachInvoke();
    window.fetch = async (input, options) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (url.hostname !== 'ipc.localhost' && url.protocol !== 'ipc:')
        return originalFetch.call(window, input, options);
      // Tauri's bridge may be installed after this new-document script. The
      // first IPC fetch attaches tracking before subsequent invoke calls.
      attachInvoke();
      const command = decodeURIComponent(url.pathname.replace(/^\//, '') || url.hostname);
      const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
      const response = value => Promise.resolve(new Response(JSON.stringify(value), { headers }));
      if (command === 'catalog_recent') {
        window.__aureReadOnlyGuard.history++;
        return response(recent);
      }
      if (command === 'catalog_sync_folders') return response({ changed: 0, issues: 0 });
      if (!reads.has(command)) {
        window.__aureReadOnlyGuard.blocked.push(command);
        headers['Tauri-Response'] = 'error';
        // Resolve a Tauri error response: rejecting fetch would trigger the
        // postMessage fallback, which could execute the forbidden write.
        return response('Read-only release acceptance blocked: ' + command);
      }
      state.pendingReads++;
      try {
        const result = await originalFetch.call(window, input, options);
        // Fetch can resolve before a streamed IPC body is complete. Drain a
        // clone before marking this read settled; invoke tracking also waits
        // for Tauri to parse the original body and deliver its callback.
        await result.clone().arrayBuffer();
        if (command === 'catalog_view') {
          let query;
          try { query = JSON.parse(options?.body || '{}').query; } catch { /* not a home-read proof */ }
          if (query?.route === 'home') state.completedHomeReads++;
        }
        return result;
      } finally { state.pendingReads--; }
    };
  }
  const session = await page.context().newCDPSession(page);
  await session.send('Page.enable');
  const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${guard.toString()})(${JSON.stringify(recent)});`,
  });
  await page.evaluate(guard, recent);
  // Prove writes are intercepted before any route can generate history.
  const result = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('catalog_patch', { patch: {} }); return false; }
    catch (error) { return String(error).includes('Read-only release acceptance blocked'); }
  });
  if (!result) throw Error('只读 IPC 保护未生效，拒绝继续验收。');
  return async () => {
    // Dispose the tested route and its queued effects while the guard is still
    // active. A fresh home document has no album/viewer history producer; it
    // also prevents old React jobs from escaping after guard removal.
    await page.goto('http://tauri.localhost/#/');
    await page.reload();
    await expect(page.getByRole('heading', { name: '发现', level: 1, exact: true })).toBeVisible();
    await page.waitForFunction(() => {
      const state = window.__aureReadOnlyGuard;
      return state && state.completedHomeReads > 0 && state.pendingReads === 0 && state.pendingInvokes === 0;
    });
    await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await page.evaluate(() => {
      const state = window.__aureReadOnlyGuard;
      if (state) {
        window.fetch = state.originalFetch;
        if (state.bridge?.invoke === state.invoke) state.bridge.invoke = state.originalInvoke;
      }
      delete window.__aureReadOnlyGuard;
    });
    await session.detach();
  };
}

export async function connectNative(endpoint, identifier) {
  if (!identifier) throw Error("原生验证必须明确指定应用 identifier");
  const receipt = identifier !== 'local.jingji.desktop' && process.env.AURE_NATIVE_EXE
    ? await readIsolatedBuild(identifier) : null;
  const browser = await chromium.connectOverCDP(
    process.env.AURE_CDP_URL || endpoint,
  );
  try {
    expect(
      await invokeNative(nativePage(browser), "plugin:app|identifier"),
    ).toBe(identifier);
    if (receipt) expect(await nativePage(browser).locator('script[type="module"]').getAttribute('src')).toBe(receipt.FrontendEntry);
    return browser;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Deterministic read-only comparison, including authorization and metadata tables. */
export function catalogSnapshot(db, format = "hash") {
  const records = tables.map((table) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
  const hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (format === "tables")
    return Object.fromEntries(
      tables.map((table, index) => [table, hash(records[index])]),
    );
  return format === "json" ? JSON.stringify(records) : hash(records);
}
