import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance of the installed production sorting controls and catalog queries.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);
const executableHash = createHash('sha256').update(await readFile(join(installed, 'aure.exe'))).digest('hex').toUpperCase();

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'tables');
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
const before = snapshot();
const originalHash = new URL(page.url()).hash;
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const output = 'verification/album-sort-installed';
await mkdir(output, { recursive: true });
try {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => {
    if (window.__sortRotationListener) document.removeEventListener('transitionrun', window.__sortRotationListener);
    window.__sortRotationSamples = [];
    window.__sortRotationListener = event => {
      if (event.propertyName === 'transform' && event.target.matches('.sort-arrow')) {
        const sample = () => window.__sortRotationSamples?.push(getComputedStyle(event.target).transform);
        requestAnimationFrame(sample);
        setTimeout(sample, 40);
        setTimeout(sample, 90);
      }
    };
    document.addEventListener('transitionrun', window.__sortRotationListener);
  });
  const transitions = [];
  for (const route of ['library', 'tags']) {
    for (const [sort, label, field] of [['updated', '最近更新', 'updated'], ['created', '创建日期', "json_extract(data,'$.createdAt')"], ['name', '名称排序', 'name COLLATE NOCASE']]) {
      await page.evaluate(({ route, sort }) => { location.hash = `#/${route}?sort=${sort}&order=desc`; scrollTo(0, 0); }, { route, sort });
      await expect(page.locator('h1')).toHaveText(route === 'library' ? '写真库' : '标签');
      await page.getByRole('button', { name: '排序', exact: true }).click();
      const menu = page.getByRole('menu', { name: '排序选项' });
      const item = menu.getByRole('menuitemradio', { name: label, exact: true });
      const arrow = item.locator('.sort-arrow');
      await expect(menu.locator('.lucide-check')).toHaveCount(0);
      await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
      await expect(menu.locator('.sort-arrow')).toHaveCount(1);
      await expect(menu.locator('.sort-direction')).toHaveCount(0);
      await expect(arrow).toHaveAttribute('data-direction', 'desc');
      const initialAngle = await arrow.evaluate(element => parseFloat(element.style.transform.replace('rotate(', '')));
      for (const [step, order] of ['asc', 'desc'].entries()) {
        const expected = db.prepare(`SELECT id FROM entities WHERE kind='albums' ORDER BY ${field} ${order},id`).all().map(row => row.id);
        await item.click();
        await expect(menu).toBeVisible();
        await expect(arrow).toHaveAttribute('data-direction', order);
        await expect(page).toHaveURL(new RegExp(`sort=${sort}&order=${order}`));
        expect(await arrow.evaluate(element => parseFloat(element.style.transform.replace('rotate(', '')))).toBe(initialAngle + (step + 1) * 180);
        const css = await arrow.evaluate(element => ({ duration: getComputedStyle(element).transitionDuration, reduced: document.documentElement.dataset.motion === 'reduced' }));
        expect(css.duration).toBe(css.reduced ? '0s' : '0.22s');
        transitions.push(css);
        const result = await invoke('catalog_view', { query: { route: 'library', sort, order, limit: 96 } });
        expect(result.db.albums.map(album => album.id)).toEqual(expected.slice(0, 96));
        if (expected.length) {
          await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
          await expect(page.locator('.album-grid .cover-link').first()).toHaveAttribute('href', `#/album/${expected[0]}`);
        }
        if (expected.length > 96) {
          const next = await invoke('catalog_view', { query: { route: 'library', sort, order, page: 1, limit: 96 } });
          expect(next.db.albums.map(album => album.id)).toEqual(expected.slice(96, 192));
        }
      }
      await expect.poll(() => arrow.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '排序', exact: true }).click();
    const menu = page.getByRole('menu', { name: '排序选项' });
    await expect.poll(() => menu.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.screenshot({ path: `${output}/${route}-menu.png` });
    await menu.getByRole('menuitemradio', { name: '名称排序', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/order=asc/);
    await expect.poll(() => menu.locator('.sort-arrow').evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: `${output}/${route}-ascending.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '排序', exact: true }).click();
    await menu.evaluate(element => { window.__originalSortMenu = element; });
    for (const [sort, label, order, field] of [
      ['updated', '最近更新', 'desc', 'updated'],
      ['created', '创建日期', 'desc', "json_extract(data,'$.createdAt')"],
      ['name', '名称排序', 'asc', 'name COLLATE NOCASE'],
    ]) {
      const item = menu.getByRole('menuitemradio', { name: label, exact: true });
      if (sort === 'name') {
        await item.focus();
        await page.keyboard.press('Enter');
      } else await item.click();
      await expect(menu).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`sort=${sort}&order=${order}`));
      await expect(item).toHaveAttribute('aria-checked', 'true');
      await expect(menu.locator('.sort-arrow')).toHaveCount(1);
      const first = db.prepare(`SELECT id FROM entities WHERE kind='albums' ORDER BY ${field} ${order},id LIMIT 1`).get();
      if (first) await expect(page.locator('.album-grid .cover-link').first()).toHaveAttribute('href', `#/album/${first.id}`);
      expect(await menu.evaluate(element => element === window.__originalSortMenu)).toBe(true);
    }
    await page.screenshot({ path: `${output}/${route}-field-switch.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('button', { name: '排序', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '排序', exact: true }).click();
    await page.mouse.click(300, 180);
    await expect(menu).toBeHidden();
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const total = db.prepare("SELECT count(*) total FROM entities WHERE kind='albums'").get().total;
  if (total > 96) await expect.poll(async () => Number(await page.locator('.album-grid').getAttribute('data-total-items'))).toBeGreaterThan(96);
  const intermediateRotation = await page.evaluate(() => window.__sortRotationSamples.some(matrix =>
    matrix !== 'matrix(1, 0, 0, 1, 0, 0)' && matrix !== 'matrix(-1, 0, 0, -1, 0, 0)' && matrix !== 'none'));
  if (transitions.some(transition => !transition.reduced)) expect(intermediateRotation).toBe(true);
  expect(snapshot()).toEqual(before);
  expect(errors).toEqual([]);
  const report = { engine: 'Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry,
    routes: ['library', 'tags'], fields: ['updated', 'created', 'name'], directions: ['asc', 'desc'],
    singleArrow: true, oneClickToggle: true, fieldSwitchKeepsMenu: true, outsideAndEscapeDismiss: true, clockwiseHalfTurn: true, intermediateRotation, transitionDurations: transitions, nativeWindows: true, keyboardToggle: true, continuousLoading: total > 96,
    catalogUnchangedDuringVerification: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(hash => {
    document.removeEventListener('transitionrun', window.__sortRotationListener);
    delete window.__sortRotationListener; delete window.__sortRotationSamples;
    delete window.__originalSortMenu;
    location.hash = /^#?\/(album|viewer)\//.test(hash) ? '/settings' : hash; scrollTo(0, 0);
  }, originalHash);
  await page.locator('.viewer').waitFor({ state: 'detached' }).catch(() => {});
  expect(snapshot()).toEqual(before);
  db.close(); await browser.close();
}
