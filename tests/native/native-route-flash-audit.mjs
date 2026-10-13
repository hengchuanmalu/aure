import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild } from '../support/native-session.mjs';

const receipt = await readInstalledBuild();
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const before = catalogSnapshot(db);
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
const originalHash = await page.evaluate(() => location.hash);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const routes = ['/', '/library', '/tags', '/models', '/favorites', '/recent', '/settings'];
const transitions = [];
try {
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  for (const from of routes) {
    for (const to of routes.filter(route => route !== from)) {
      await page.evaluate(path => { location.hash = path; scrollTo(0, 0); }, from);
      await page.waitForTimeout(500);
      const result = await page.evaluate(async to => {
        const main = document.querySelector('.page-content');
        const sourceGrid = main.querySelector('.virtual-grid');
        const sourceShell = document.querySelector('.topbar');
        const known = new Set([...main.querySelectorAll('.photo-frame[data-photo-state="ready"] img')].map(image => image.getAttribute('src')));
        const read = () => {
          const photos = [...main.querySelectorAll('.photo-frame')].filter(photo => {
            const rect = photo.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 82;
          });
          const ready = photos.filter(photo => photo.dataset.photoState === 'ready').length;
          const loading = photos.filter(photo => photo.dataset.photoState === 'loading').length;
          const reusedLoading = photos.filter(photo => photo.dataset.photoState === 'loading' && known.has(photo.querySelector('img')?.getAttribute('src'))).length;
          return { ready, loading, reusedLoading, count: photos.length, empty: !main.querySelector('h1, .recovery, .viewer') };
        };
        const samples = [];
        const start = performance.now();
        location.hash = to;
        while (performance.now() - start < 450) {
          await new Promise(requestAnimationFrame);
          samples.push({ ms: Math.round(performance.now() - start), ...read() });
        }
        const blankPhotos = samples.filter(sample => sample.loading > 0 && sample.ready === 0);
        return { sameGrid: !!sourceGrid && sourceGrid === main.querySelector('.virtual-grid'),
          sameShell: sourceShell === document.querySelector('.topbar'), emptyFrames: samples.filter(sample => sample.empty).length,
          photoBlankFrames: blankPhotos.length, photoBlankUntilMs: blankPhotos.at(-1)?.ms || 0,
          reusedLoadingFrames: samples.filter(sample => sample.reusedLoading > 0).length, samples: samples.slice(0, 12) };
      }, to);
      transitions.push({ from, to, ...result });
    }
    console.log(JSON.stringify({ from, checks: 6, photoBlankTransitions: transitions.filter(item => item.from === from && item.photoBlankFrames > 0).length }));
  }
  expect(errors).toEqual([]);
  expect(catalogSnapshot(db)).toBe(before);
  const output = 'verification/route-flash-audit-installed';
  await mkdir(output, { recursive: true });
  const report = { receipt, transitions, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: transitions.length, emptyTransitions: transitions.filter(item => item.emptyFrames > 0).length,
    photoBlankTransitions: transitions.filter(item => item.photoBlankFrames > 0).length, catalogUnchanged: true }));
} finally {
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  db.close();
  await browser.close();
}
