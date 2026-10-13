import { nativePage, readInstalledBuild, connectNative, catalogSnapshot } from '../support/native-session.mjs';
// Production acceptance cancels all drafts; write checks use a separate identifier.
import { expect } from '@playwright/test';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const installed = process.argv.includes('--installed');
const output = resolve('verification/cover-editor');
await mkdir(output, { recursive: true });
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9256', installed ? 'local.jingji.desktop' : 'local.jingji.cover-test');
const page = nativePage(browser);
if (!page) throw Error('WebView2 page missing');
page.setDefaultTimeout(15000);
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const hash = value => createHash('sha256').update(value).digest('hex');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let database;
try {
  expect(await invoke('plugin:app|identifier')).toBe(installed ? 'local.jingji.desktop' : 'local.jingji.cover-test');
  let album, before, snapshot, hashes, media;
  if (installed) {
    const root = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
    const receipt = await readInstalledBuild(root);
    expect(hash(await readFile(join(root, 'aure.exe'))).toUpperCase()).toBe(receipt.ExecutableHash);
    expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
    database = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
    snapshot = () => catalogSnapshot(database);
    before = snapshot();
    const row = database.prepare("SELECT e.data FROM entities e JOIN summaries s ON s.album=e.id WHERE e.kind='albums' AND s.images>48 ORDER BY (e.name='碧蓝航线 爱宕赛车服') DESC LIMIT 1").get();
    if (!row) throw Error('No album with more than 48 photos');
    album = JSON.parse(row.data);
    const recent = database.prepare('SELECT * FROM recent ORDER BY at DESC').all().map(row => ({ albumId: row.album, ...(row.media ? { mediaId: row.media } : {}), at: row.at }));
    await page.evaluate(recent => {
      window.__coverOriginalFetch = window.fetch;
      window.__coverProbe = true;
      window.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        if (url.hostname === 'ipc.localhost') {
          const command = decodeURIComponent(url.pathname.slice(1));
          const headers = { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' };
          if (command === 'catalog_view' && window.__coverProbe) return Promise.resolve(new Response(JSON.stringify({ readProbe: true }), { headers }));
          if (command === 'catalog_recent') return Promise.resolve(new Response(JSON.stringify(recent), { headers }));
          if (['catalog_operation', 'catalog_patch', 'catalog_reset', 'catalog_restore_recent'].includes(command)) return Promise.resolve(new Response(JSON.stringify('Read-only acceptance'), { headers: { ...headers, 'Tauri-Response': 'error' } }));
        }
        return window.__coverOriginalFetch.call(window, input, options);
      };
    }, recent);
    expect((await invoke('catalog_view', { query: {} })).readProbe).toBe(true);
    await page.evaluate(() => { window.__coverProbe = false; });
    const sources = database.prepare("SELECT e.data FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY r.position LIMIT 3").all(album.id).map(row => JSON.parse(row.data));
    media = sources.filter(item => item.sourcePath);
    hashes = await Promise.all(media.map(async item => hash(await readFile(item.sourcePath))));
  } else {
    const root = join(output, 'files');
    await mkdir(root, { recursive: true });
    media = [];
    for (let i = 0; i < 65; i++) {
      const id = `cover-native-${i}`, path = join(root, `${id}.jpg`);
      await copyFile(resolve(`tests/fixtures/media/${i % 2 ? 'p-774909' : 'p-1239291'}.jpg`), path);
      media.push({ id, sourcePath: path, src: `http://jingji.localhost/media/${id}`, kind: 'image', name: `${id}.jpg`, width: 1600, height: 2400,
        size: (await stat(path)).size, tags: [], favorite: false, liked: false, rating: 0 });
    }
    hashes = await Promise.all(media.map(async item => hash(await readFile(item.sourcePath))));
    album = { id: 'native-cover-album', name: '封面取景验收', subtitle: '', description: '', cover: media[0].src, coverMediaId: media[0].id,
      mediaIds: media.map(item => item.id), modelIds: [], tags: [], favorite: false, createdAt: '2026-10-07', updatedAt: '2026-10-07' };
    await invoke('catalog_reset', { seed: { version: 1, media, albums: [album], models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: false } } });
    database = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.cover-test', 'catalog.sqlite3'));
    for (const item of media) database.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(item.sourcePath.replaceAll('\\', '/').toLowerCase());
  }
  if (installed) await page.evaluate(id => { location.hash = `/album/${id}`; }, album.id);
  else { await page.goto(`http://tauri.localhost/#/album/${album.id}`); await page.reload(); }
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  const area = picker.locator('.cover-stage');
  const rail = picker.locator('.cover-filmstrip');
  await expect(area).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(area).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('border-width', '0px');
  await expect(rail).toHaveCSS('box-shadow', 'none');
  const stage = picker.getByRole('group', { name: '封面取景区域', exact: true });
  await expect.poll(() => stage.evaluate(element => {
    const image = element.querySelector('img');
    return image?.naturalHeight ? Math.abs(element.clientWidth / element.clientHeight - image.naturalWidth / image.naturalHeight) : 1;
  })).toBeLessThan(.01);
  const fittedBox = await stage.boundingBox();
  await page.getByLabel('写真集名称', { exact: true }).hover();
  await expect(rail).toHaveCSS('opacity', '0');
  await expect(rail).toHaveAttribute('inert', '');
  await page.screenshot({ path: join(output, installed ? 'installed-full.png' : 'isolated-full.png') });
  await area.hover({ position: { x: 20, y: (await area.boundingBox()).height * .7 } });
  await expect(rail).toHaveCSS('opacity', '1');
  const areaBox = await area.boundingBox(), railBox = await rail.boundingBox();
  expect(Math.abs(areaBox.y + areaBox.height - railBox.y - railBox.height)).toBeLessThanOrEqual(2);
  expect(await stage.boundingBox()).toEqual(fittedBox);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '选择封面', exact: true })).toHaveCount(0);
  const strip = picker.getByRole('group', { name: '封面照片', exact: true });
  await expect.poll(() => picker.locator('.cover-thumbnail').count()).toBeGreaterThan(0);
  expect(await picker.locator('.cover-thumbnail').count()).toBeLessThan(30);
  await expect(picker.locator('input[type=range]')).toHaveCount(0);
  await expect(picker.locator('.cover-crop-grid')).toBeVisible();
  await expect(stage.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect(picker.getByRole('button', { name: /滚动封面照片/ })).toHaveCount(0);
  await expect(rail.locator('[title]')).toHaveCount(0);
  await expect(stage).not.toHaveAttribute('title');
  const hoveredChoice = picker.getByRole('button', { name: '封面 素材 2', exact: true });
  const choiceBefore = await hoveredChoice.boundingBox();
  await hoveredChoice.hover();
  await expect(hoveredChoice).toHaveCSS('scale', '1.08');
  const choiceAfter = await hoveredChoice.boundingBox();
  expect(Math.abs(choiceAfter.x + choiceAfter.width / 2 - choiceBefore.x - choiceBefore.width / 2)).toBeLessThan(1);
  expect(Math.abs(choiceAfter.y + choiceAfter.height - choiceBefore.y - choiceBefore.height)).toBeLessThan(1);
  await expect(hoveredChoice.locator('.photo-frame')).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.333) 0px 4px 10px 0px');
  await page.screenshot({ path: join(output, installed ? 'installed-hover.png' : 'isolated-hover.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hoveredChoice).toHaveCSS('scale', '1');
  await expect(hoveredChoice).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await hoveredChoice.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  await picker.getByRole('group', { name: '显示封面缩略图', exact: true }).press('Enter');
  await expect(rail).toHaveAttribute('data-visible', 'true');
  await strip.press('End');
  await expect.poll(() => strip.evaluate(el => Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth))).toBeLessThan(1);
  const count = installed ? (await invoke('catalog_candidates', { kind: 'media', page: 0, query: { kind: 'image', album: album.id } })).total : 65;
  const last = picker.getByRole('button', { name: `封面 素材 ${count}`, exact: true });
  await expect(last).toBeVisible();
  const lastBefore = await last.boundingBox();
  await last.hover();
  await expect(last).toHaveCSS('scale', '1.08');
  const lastAfter = await last.boundingBox();
  expect(Math.abs(lastAfter.x + lastAfter.width / 2 - lastBefore.x - lastBefore.width / 2)).toBeLessThan(1);
  expect(Math.abs(lastAfter.y + lastAfter.height - lastBefore.y - lastBefore.height)).toBeLessThan(1);
  expect(lastAfter.width / lastBefore.width).toBeCloseTo(1.08, 2);
  await page.screenshot({ path: join(output, installed ? 'installed-last-hover.png' : 'isolated-last-hover.png') });
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(last).toHaveCSS('border-color', 'rgb(38, 38, 38)');
  await expect.poll(() => stage.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await stage.hover(); await page.mouse.wheel(0, -100);
  await expect(stage.locator('img')).toHaveCSS('transform', 'matrix(1.11, 0, 0, 1.11, 0, 0)');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10); await page.mouse.up();
  expect(await stage.locator('img').evaluate(image => image.style.objectPosition)).not.toBe('50% 50%');
  await picker.getByRole('button', { name: '恢复默认封面' }).click();
  await area.hover({ position: { x: 20, y: (await area.boundingBox()).height * .7 } });
  await last.click();
  await stage.press('+'); await stage.press('ArrowUp'); await stage.press('ArrowLeft');
  await page.getByLabel('写真集名称', { exact: true }).hover();
  await expect(rail).toHaveCSS('opacity', '0');
  await expect(rail).toHaveAttribute('inert', '');
  await area.hover({ position: { x: 20, y: (await area.boundingBox()).height * .7 } });
  await expect(rail).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(output, installed ? 'installed.png' : 'isolated.png') });
  if (installed) {
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    expect(snapshot()).toBe(before);
  } else {
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await invoke('catalog_entity', { kind: 'albums', id: album.id });
    expect(saved.coverMediaId).toBe('cover-native-64');
    expect(saved.coverCrop).toEqual({ x: 48, y: 48, zoom: 1.1 });
    expect(saved.mediaIds).toEqual(album.mediaIds);
    await page.reload();
    await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
    await expect(stage.locator('img')).toHaveCSS('object-position', '50% 50%');
    await stage.press('+');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    expect((await invoke('catalog_entity', { kind: 'albums', id: album.id })).coverCrop).toEqual(saved.coverCrop);
  }
  expect(await Promise.all(media.map(async item => hash(await readFile(item.sourcePath))))).toEqual(hashes);
  expect(errors).toEqual([]);
  await writeFile(join(output, installed ? 'installed.json' : 'isolated.json'), JSON.stringify({ engine: 'Windows WebView2', installed, filmstrip: true,
    fullImageFit: true, floatingHover: true, inlinePanel: true, boundedDOM: true, wheel: true, drag: true, keyboard: true, reset: true, saveReload: !installed, cancel: true, catalogUnchanged: installed,
    originalHashesUnchanged: true, errors }, null, 2));
  console.log(installed ? 'Installed build, cover filmstrip/crop, cancelled drafts, unchanged catalog and originals passed.' : 'Isolated cover save/reload, 65-photo scrolling, crop and original preservation passed.');
} finally {
  if (installed) await page.evaluate(() => { if (window.__coverOriginalFetch) { window.fetch = window.__coverOriginalFetch; delete window.__coverOriginalFetch; delete window.__coverProbe; } });
  database?.close(); await browser.close();
}
