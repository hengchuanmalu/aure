import { connectNative, nativePage } from '../support/native-session.mjs';
// Real Windows WebView2, disposable files and an isolated catalog only.
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';

const identifier = 'local.aure.video-preview-audit-20261006';
const output = resolve('verification/video-preview');
await mkdir(output, { recursive: true });
const samples = [['direct.mp4', 'libx264'], ['hevc.mp4', 'libx265']];
for (const [name, codec] of samples) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-t', '15', '-c:v', codec, '-threads', '2', '-pix_fmt', 'yuv420p', ...(codec === 'libx265' ? ['-x265-params', 'pools=2:frame-threads=2'] : []), join(output, name)], { windowsHide: true });
  if (result.status) throw Error(String(result.stderr));
}
await writeFile(join(output, 'broken.mkv'), 'invalid disposable video');
const media = await Promise.all([...samples.map(s => s[0]), 'broken.mkv'].map(async (name, index) => ({
  id: `preview-${index}`, name, kind: 'video', src: `http://jingji.localhost/media/preview-${index}`, sourcePath: join(output, name),
  size: (await stat(join(output, name))).size, width: 320, height: 240, duration: 15, tags: [], favorite: false, liked: false, rating: 0,
})));
const hashes = await Promise.all(media.map(async m => createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')));
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9240', identifier);
const page = nativePage(browser);
if (!page) throw Error('No WebView2 page');
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
try {
  expect(await invoke('plugin:app|identifier')).toBe(identifier);
  await invoke('catalog_reset', { seed: { version: 1, albums: [{ id: 'previews', name: '视频预览验证', number: '', subtitle: '', description: '', cover: '', mediaIds: media.map(m => m.id), modelIds: [], tags: [], favorite: false, createdAt: '2026-10-06', updatedAt: '2026-10-06' }], media, models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: false } } });
  const db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
  for (const m of media) db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(m.sourcePath.replaceAll('\\', '/').toLowerCase());
  db.close();
  await page.goto('http://tauri.localhost/#/album/previews');
  await page.reload();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const first = page.locator('[data-media-id="preview-0"]');
  const second = page.locator('[data-media-id="preview-1"]');
  await expect.poll(() => first.locator('.media-open > img').evaluate(img => img.naturalWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => second.locator('.media-open > img').evaluate(img => img.naturalWidth), { timeout: 30000 }).toBeGreaterThan(0);
  const recentBefore = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'), { readOnly: true });
  const recentCount = recentBefore.prepare('SELECT COUNT(*) count FROM recent').get().count;
  recentBefore.close();
  const frames = [];
  for (const percent of [10, 50, 90]) {
    const url = await invoke('image_thumbnail', { source: `video:preview-0:${percent}` });
    expect(url).toMatch(/^http:\/\/jingji\.localhost\/thumbnail\/[0-9a-f]{64}$/);
    const contents = await readFile(join(process.env.LOCALAPPDATA, identifier, 'thumbnails-v1', `${url.split('/').at(-1)}.jpg`));
    frames.push({ percent, hash: createHash('sha256').update(contents).digest('hex') });
  }
  expect(new Set(frames.map(f => f.hash)).size).toBe(3);
  await first.hover();
  await expect(first).toHaveAttribute('data-preview', 'playing');
  await expect.poll(() => first.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
  await expect(first.getByRole('progressbar')).toBeVisible();
  await first.screenshot({ path: join(output, 'playing.png') });
  await second.hover();
  await expect(first).toHaveAttribute('data-preview', 'idle');
  expect(await first.locator('video').getAttribute('src')).toBeNull();
  await expect(second).toHaveAttribute('data-preview', 'playing', { timeout: 60000 });
  expect(await second.locator('video').evaluate(v => v.muted)).toBe(true);
  expect(await second.locator('video').getAttribute('src')).toContain('/preview-');
  await expect.poll(() => second.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
  expect(await second.locator('video').evaluate(v => v.duration)).toBeLessThanOrEqual(12.1);
  await page.mouse.move(0, 0);
  await expect(second).toHaveAttribute('data-preview', 'idle');
  expect(await second.locator('video').getAttribute('src')).toBeNull();
  const warmId = randomUUID();
  const warm = await invoke('prepare_video', { id: 'preview-1', requestId: warmId, force: false, preview: true });
  expect(warm.cached).toBe(true);
  expect(warm.preview).toBe(true);
  expect(warm.duration).toBeGreaterThan(14.9);
  await invoke('cancel_video', { requestId: warmId });
  await expect(page.locator('.video-cover-trigger')).toHaveCount(0);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const setting = page.getByRole('combobox', { name: '视频封面取帧位置' });
  await expect(setting).toHaveValue('10');
  await setting.selectOption('90');
  await expect(setting).toHaveValue('90');
  await expect(setting).toBeEnabled();
  await page.reload();
  await expect(setting).toHaveValue('90');
  await page.screenshot({ path: join(output, 'cover-settings.png') });
  await page.goto('http://tauri.localhost/#/album/previews');
  await page.reload();
  await expect.poll(() => first.locator('.media-open > img').getAttribute('src')).toBe(await invoke('image_thumbnail', { source: 'video:preview-0:90' }));
  await expect.poll(() => second.locator('.media-open > img').getAttribute('src')).toBe(await invoke('image_thumbnail', { source: 'video:preview-1:90' }));
  expect((await invoke('catalog_entity', { kind: 'media', id: 'preview-0' })).videoPosterPercent).toBeUndefined();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await first.locator('.media-open').focus();
  await expect(first).toHaveAttribute('data-preview', 'playing');
  expect(await first.locator('.preview-bars i').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(first).toHaveAttribute('data-preview', 'idle');
  const broken = page.locator('[data-media-id="preview-2"]');
  await broken.hover();
  await expect(broken).toHaveAttribute('data-preview', 'error');
  await expect(invoke('image_thumbnail', { source: 'video:unknown:10' })).rejects.toThrow();
  await expect(invoke('image_thumbnail', { source: 'video:preview-0:255' })).rejects.toThrow();
  const verifyDb = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'), { readOnly: true });
  expect(verifyDb.prepare('SELECT COUNT(*) count FROM recent').get().count).toBe(recentCount);
  expect(verifyDb.prepare('SELECT COUNT(*) count FROM recent WHERE media IS NOT NULL').get().count).toBe(0);
  verifyDb.close();
  for (let i = 0; i < media.length; i++) expect(createHash('sha256').update(await readFile(media[i].sourcePath)).digest('hex')).toBe(hashes[i]);
  expect(errors).toEqual([]);
  const result = { engine: 'Windows WebView2', frames, automaticPosters: true, globalSettingPersists: true, globalSettingAppliesToBothVideos: true, cardCoverTriggerRemoved: true, directAndColdHevcHover: true, warmPreviewCache: true, progress: true, exclusivePlayback: true, release: true, keyboardAndReducedMotion: true, authorization: true, noRecentVisits: true, originalHashesUnchanged: true, errors };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
