import { connectNative, nativePage } from '../support/native-session.mjs';
// Read-only warm page-return timings in the installed Windows WebView2 release.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
try {
  const page = nativePage(browser);
  if (!page) throw Error('Installed WebView2 page missing');
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  const requests = [];
  page.on('response', response => {
    if (response.url().startsWith('http://jingji.localhost/media/')) {
      requests.push({ status: response.status(), bytes: Number(response.headers()['content-length'] || 0), cache: response.headers()['cache-control'] });
    }
  });
  const queryMs = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await window.__TAURI_INTERNALS__.invoke('catalog_view', { query: { route: 'home' } });
      samples.push(performance.now() - start);
    }
    return samples;
  });
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { window.__previousHero = document.querySelector('.featured-grid .cover-link img'); });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('设置');
    const requestStart = requests.length;
    await page.evaluate(() => {
      window.__homeReturnStart = performance.now();
      window.__homeReturnObserver?.disconnect();
      const trace = window.__homeReturnTrace = { mountedMs: null, heroLoadMs: null, heroPaintedMs: null, decodedMs: null, paintedMs: null };
      const observer = window.__homeReturnObserver = new MutationObserver(() => {
        const images = [...document.querySelectorAll('.featured-grid .cover-link img')];
        if (images.length !== 5) return;
        observer.disconnect();
        trace.mountedMs = performance.now() - window.__homeReturnStart;
        const ready = img => img.complete && img.naturalWidth > 0 ? Promise.resolve() : new Promise((resolve, reject) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', reject, { once: true }); });
        ready(images[0]).then(() => { trace.heroLoadMs = performance.now() - window.__homeReturnStart; });
        ready(images[0]).then(() => images[0].decode()).then(() => requestAnimationFrame(() => requestAnimationFrame(() => { trace.heroPaintedMs = performance.now() - window.__homeReturnStart; })));
        Promise.all(images.map(async img => { await ready(img); await img.decode(); })).then(() => {
          trace.decodedMs = performance.now() - window.__homeReturnStart;
          requestAnimationFrame(() => requestAnimationFrame(() => { trace.paintedMs = performance.now() - window.__homeReturnStart; }));
        });
      });
      observer.observe(document.getElementById('root'), { childList: true, subtree: true });
      document.querySelector('.sidebar a[href="#/"]').click();
    });
    await expect(page.getByRole('heading', { name: '推荐', exact: true })).toBeVisible();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.featured-grid .cover-link img')];
      return images.length === 5 && images.every(img => img.complete && img.naturalWidth > 0);
    });
    const result = await page.evaluate(async () => {
      const images = [...document.querySelectorAll('.featured-grid .cover-link img')];
      await Promise.all(images.map(img => img.decode()));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { allCoversReadyMs: performance.now() - window.__homeReturnStart, heroWidth: images[0].naturalWidth, sameHeroNode: images[0] === window.__previousHero, trace: window.__homeReturnTrace };
    });
    const responses = requests.slice(requestStart);
    samples.push({ ...result, originalRequests: responses.length, responseBodyBytes: responses.reduce((total, r) => total + (r.status === 304 ? 0 : r.bytes), 0), responses });
  }
  const times = samples.map(s => s.allCoversReadyMs).sort((a, b) => a - b);
  const heroTimes = samples.map(s => s.trace.heroPaintedMs).sort((a, b) => a - b);
  const report = { engine: 'Windows WebView2', build: 'release', cache: 'existing disk/profile; repeated settings to home; decoded covers and two animation frames', queryMs, medianMs: times[2], heroMedianMs: heroTimes[2], maxMs: times[4], samples };
  await mkdir('verification/home-performance', { recursive: true });
  await writeFile(`verification/home-performance/${process.env.AURE_HOME_BENCH_PHASE || 'after'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
