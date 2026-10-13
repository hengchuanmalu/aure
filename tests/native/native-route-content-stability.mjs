import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild } from '../support/native-session.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => { location.hash = '#/library'; scrollTo(0, 0); });
  await expect(page.locator('.album-grid .fan-front .photo-frame').first()).toHaveAttribute('data-photo-state', 'ready');
  const checks = [];
  for (const path of ['/tags', '/library', '/tags', '/library']) {
    const result = await page.evaluate(async path => {
      const grid = document.querySelector('.album-grid');
      const card = grid?.querySelector('[data-grid-id]');
      const photo = card?.querySelector('.fan-front .photo-frame');
      let removed = false, lostReady = false;
      const observer = new MutationObserver(() => {
        removed ||= !grid?.isConnected || !card?.isConnected;
        lostReady ||= photo?.getAttribute('data-photo-state') !== 'ready';
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-photo-state'] });
      location.hash = path;
      await new Promise(resolve => setTimeout(resolve, 450));
      observer.disconnect();
      return { path, removed, lostReady, sameGrid: grid === document.querySelector('.album-grid') };
    }, path);
    expect(result.removed).toBe(false);
    expect(result.lostReady).toBe(false);
    expect(result.sameGrid).toBe(true);
    checks.push(result);
  }
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const output = 'verification/route-content-stability-installed';
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/library.png` });
  const report = { receipt, checks, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  db.close();
  await browser.close();
}
