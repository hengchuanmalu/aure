import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance of the installed release and its real WebView2 scrolling.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
let testedPage;
try {
  const page = nativePage(browser);
  testedPage = page;
  await page.emulateMedia({ reducedMotion: null });
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://tauri.localhost/#/');
  const shelf = page.locator('.album-shelf');
  const rail = shelf.locator('.shelf-rail');
  const previous = shelf.getByRole('button', { name: '上一组图集' });
  const next = shelf.getByRole('button', { name: '下一组图集' });
  await expect(shelf.locator('.shelf-position')).toHaveCount(0);
  expect(await shelf.locator('.section-title > .row').evaluate(row => [...row.children].map(child => child.textContent || child.getAttribute('aria-label')))).toEqual(['查看全部', '上一组图集', '下一组图集']);
  const updated = page.locator('.rail-section').filter({ has: page.getByRole('heading', { name: '最近更新', exact: true }) });
  const actions = section => section.locator('.section-title > .row').evaluate(row => ({ gap: getComputedStyle(row).gap, children: [...row.children].map(child => ({ tag: child.tagName, fontSize: getComputedStyle(child).fontSize, width: child.getBoundingClientRect().width, height: child.getBoundingClientRect().height })) }));
  expect(await actions(shelf)).toEqual(await actions(updated));
  for (const title of ['最近更新', '最近浏览']) {
    const section = page.locator('.rail-section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const track = section.locator('.rail');
    await expect(track).toHaveCSS('scrollbar-width', 'none');
    await expect(track).toHaveCSS('overflow-x', 'auto');
    expect(await track.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').display)).toBe('none');
    await section.screenshot({ path: `verification/shelf-scroll/${title}-installed.png` });
  }
  await rail.scrollIntoViewIfNeeded();
  await expect(next).toBeEnabled();
  const initial = await rail.locator('.shelf-grid:not([inert]) .cover-link').evaluateAll(links => links.map(e => e.getAttribute('href')));
  const delta = () => rail.evaluate(el => {
    const groups = [...el.children];
    return Math.abs(el.scrollLeft - groups.find(g => !g.inert).offsetLeft + groups[0].offsetLeft);
  });
  await rail.evaluate(el => {
    window.__shelfFirstCard = el.querySelector('.album-card');
    window.__shelfSamples = [];
    el.addEventListener('scroll', () => window.__shelfSamples.push(el.scrollLeft), { passive: true });
  });
  await next.click();
  await expect.poll(delta).toBeLessThanOrEqual(1);
  const second = await rail.locator('.shelf-grid:not([inert]) .cover-link').evaluateAll(links => links.map(e => e.getAttribute('href')));
  expect(second.every(href => !initial.includes(href))).toBe(true);
  const retained = await rail.evaluate(el => el.querySelector('.album-card') === window.__shelfFirstCard);
  expect(retained).toBe(true);
  const samples = await page.evaluate(() => window.__shelfSamples);
  const end = await rail.evaluate(el => el.scrollLeft);
  const reduced = await rail.evaluate(el => el.closest('[data-reduced-motion]')?.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!reduced) expect(samples.some(left => left > 0 && left < end - 1)).toBe(true);
  await mkdir('verification/shelf-scroll', { recursive: true });
  await expect.poll(() => rail.locator('.shelf-grid:not([inert]) img').evaluateAll(images => images.every(i => i.complete && i.naturalHeight > 0))).toBe(true);
  await shelf.screenshot({ path: 'verification/shelf-scroll/installed.png' });
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBe(0);
  await next.dblclick();
  await expect.poll(delta).toBeLessThanOrEqual(1);
  await expect(next).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await previous.click();
  expect(await delta()).toBeLessThanOrEqual(1);
  await page.emulateMedia({ reducedMotion: null });
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const report = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry, nativeScrollFrames: samples.length, continuousMotion: reduced ? 'disabled by preference' : true, retainedCards: retained, entireGroupReplaced: true, rapidClicks: true, keyboard: true, systemReducedMotion: true, catalogUnchanged: true, errors };
  await writeFile('verification/shelf-scroll/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await testedPage?.emulateMedia({ reducedMotion: null }); db.close(); await browser.close(); }
