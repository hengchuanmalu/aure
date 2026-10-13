import { connectNative, nativePage } from '../support/native-session.mjs';
// Measure the actual hero pixels, without forcing full-size decode() on all five originals.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
try {
  const page = nativePage(browser);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  await page.goto('http://tauri.localhost/#/');
  const hero = page.locator('.featured-grid .cover-link img').first();
  await expect.poll(() => hero.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const capture = async () => {
    const box = await hero.boundingBox();
    return createHash('sha256').update(await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), width: 16, height: 16 } })).digest('hex');
  };
  // Use two stable reference frames, outside the measured page-return samples.
  let previous = '', expected = '';
  await expect.poll(async () => {
    const current = await capture();
    const stable = current === previous;
    previous = current; expected = current;
    return stable;
  }).toBe(true);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('设置');
    await page.evaluate(() => { window.__returnStart = performance.now(); document.querySelector('.sidebar a[href="#/"]').click(); });
    await expect(hero).toBeVisible();
    await expect.poll(capture).toBe(expected);
    samples.push(await page.evaluate(() => performance.now() - window.__returnStart));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const report = { engine: 'Windows WebView2', mode: 'release', script: await page.locator('script[type=module]').getAttribute('src'), measurement: 'settings to homepage; actual stable original hero pixels in a 16x16 screenshot; existing disk/profile cache', medianMs: sorted[2], maxMs: sorted[4], samples };
  await mkdir('verification/home-performance', { recursive: true });
  await writeFile(`verification/home-performance/${process.env.AURE_HOME_BENCH_PHASE || 'after'}-visual.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
