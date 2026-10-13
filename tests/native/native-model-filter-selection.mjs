import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
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
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('.filter-indicator')).toBeVisible();
  const count = await page.locator('.model-filters button').count();
  expect(count).toBeGreaterThan(1);
  const results = [];
  for (const index of [...Array.from({ length: count - 1 }, (_, i) => i + 1), 0]) {
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(100);
    const result = await page.evaluate(async index => {
      const root = document.querySelector('.model-filters');
      const target = root.querySelectorAll('button')[index];
      const beforeScroll = scrollY;
      const samples = [];
      target.click();
      const until = performance.now() + 350;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        samples.push(root.querySelector('.filter-indicator').getBoundingClientRect().y - root.getBoundingClientRect().y);
      }
      const indicator = root.querySelector('.filter-indicator').getBoundingClientRect();
      const selected = target.getBoundingClientRect();
      return { index, beforeScroll, afterScroll: scrollY, samples, expectedY: target.offsetTop,
        errorX: Math.abs(indicator.x - selected.x), errorWidth: Math.abs(indicator.width - selected.width) };
    }, index);
    for (const y of result.samples) expect(y).toBeCloseTo(result.expectedY, 0);
    expect(result.errorX).toBeLessThan(1);
    expect(result.errorWidth).toBeLessThan(1);
    results.push({ index, scrollDelta: result.afterScroll - result.beforeScroll, frames: result.samples.length });
  }
  expect(results.some(result => Math.abs(result.scrollDelta) > 50)).toBe(true);
  await page.locator('.model-filters').evaluate(root => {
    for (const index of [1, 0, 1, 0]) root.querySelectorAll('button')[index].click();
  });
  await page.waitForTimeout(300);
  await expect(page.locator('.filter-indicator')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.model-filters button').nth(1).click();
  await page.waitForTimeout(100);
  expect(await page.locator('.model-filters').evaluate(root => {
    const selected = root.querySelector('[aria-pressed="true"]').getBoundingClientRect();
    const indicator = root.querySelector('.filter-indicator').getBoundingClientRect();
    return Math.abs(selected.x - indicator.x) + Math.abs(selected.y - indicator.y);
  })).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.model-filters button').first().click();
  await page.waitForTimeout(300);
  await mkdir('verification/model-filter-selection-installed', { recursive: true });
  await page.screenshot({ path: 'verification/model-filter-selection-installed/filters.png' });
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const report = { results, rapidSwitching: true, reducedMotion: true, catalogUnchanged: true,
    frontendEntry: receipt.FrontendEntry, executableHash: receipt.ExecutableHash, errors };
  await writeFile('verification/model-filter-selection-installed/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  db.close();
  await browser.close();
}
