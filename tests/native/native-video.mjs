import { connectNative, nativePage, isolatedIdentifier } from '../support/native-session.mjs';
// Disposable codec matrix in a separate Windows WebView2 application/catalog.
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';

const identifier = isolatedIdentifier('local.aure.video-audit-20261005');
const output = resolve('verification/video-audit');
await mkdir(output, { recursive: true });
const matrix = [
  ['h264.mp4', 'libx264', 'aac', []],
  ['hevc.mp4', 'libx265', 'aac', ['-x265-params', 'pools=2:frame-threads=2']],
  ['10bit.mkv', 'libx264', 'ac3', ['-pix_fmt', 'yuv420p10le']],
  ['mpeg4.avi', 'mpeg4', 'mp3', []],
  ['legacy.wmv', 'wmv2', 'wmav2', []],
  ['vp9.webm', 'libvpx-vp9', 'libopus', []],
  ['broadcast.ts', 'mpeg2video', 'ac3', []],
  ['h264.mov', 'libx264', 'aac', []],
];
for (const [name, video, audio, extra] of matrix) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', video, '-threads', '2', '-c:a', audio, ...extra, join(output, name)], { windowsHide: true });
  if (result.error || result.status !== 0) throw Error(`${name}: ${result.error?.message || result.stderr}`);
}
await writeFile(join(output, 'broken.mkv'), 'invalid disposable video');
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9238', identifier);
const page = nativePage(browser);
if (!page) throw Error('No WebView2 page');
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
try {
  expect(await invoke('plugin:app|identifier')).toBe(identifier);
  const names = [...matrix.map(x => x[0]), 'broken.mkv'];
  const media = await Promise.all(names.map(async (name, i) => ({
    id: `codec-${i}`, name, kind: 'video', src: `http://jingji.localhost/media/codec-${i}`, sourcePath: join(output, name),
    size: (await stat(join(output, name))).size, width: 320, height: 240, duration: 4, tags: [], favorite: false, liked: false, rating: 0,
  })));
  const hashes = await Promise.all(media.map(async m => createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')));
  await invoke('catalog_reset', { seed: { version: 1, albums: [{ id: 'codecs', name: 'Codec samples', number: '', subtitle: '', description: '', cover: '', mediaIds: media.map(m => m.id), modelIds: [], tags: [], favorite: false, createdAt: '2026-10-05', updatedAt: '2026-10-05' }], media, models: [], tags: [], groups: [], recent: [], settings: { reducedMotion: true } } });
  const db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
  for (const m of media) db.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(m.sourcePath.replaceAll('\\', '/').toLowerCase());
  db.close();
  // Fixture IPC bypasses the Provider's reset/refresh operation.
  await page.reload();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const results = [];
  for (let i = 0; i < matrix.length; i++) {
    await page.goto(`http://tauri.localhost/#/viewer/codecs/codec-${i}`);
    const video = page.locator('.media-stage video');
    await expect.poll(() => video.evaluate(v => v.videoWidth), { timeout: 45000 }).toBe(320);
    await page.mouse.move(500, 300);
    if (await video.evaluate(v => v.paused)) await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(() => video.evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames), { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(0.2);
    await page.getByLabel('播放进度', { exact: true }).fill('2');
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(1.9);
    const sample = await video.evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, frames: v.getVideoPlaybackQuality().totalVideoFrames, src: v.currentSrc, audio: v.webkitAudioDecodedByteCount }));
    expect(sample.audio).toBeGreaterThan(0);
    expect(sample.duration).toBeGreaterThan(3.8);
    const req = randomUUID();
    const warm = await invoke('prepare_video', { id: `codec-${i}`, requestId: req, force: false, preview: true });
    if (![0, 7].includes(i)) expect(warm.cached).toBe(true);
    await invoke('cancel_video', { requestId: req });
    results.push({ name: matrix[i][0], ...sample, warmCache: warm.cached || false });
    console.log(JSON.stringify(results.at(-1)));
  }
  await page.goto('http://tauri.localhost/#/viewer/codecs/codec-8');
  await expect(page.getByRole('alert')).toContainText('无法解码');
  await page.mouse.move(500, 300);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法解码');
  await page.getByRole('button', { name: '上一项', exact: true }).click();
  await expect.poll(() => page.locator('.media-stage video').evaluate(v => v.videoWidth)).toBe(320);
  await page.goto('http://tauri.localhost/#/album/codecs');
  const card = page.locator('[data-media-id="codec-1"]');
  await card.hover();
  await expect(card).toHaveAttribute('data-preview', 'playing');
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute('data-preview', 'idle');
  expect(await card.locator('video').getAttribute('src')).toBeNull();
  // Fresh source revision invalidates cached output; cancel its conversion.
  const { utimes } = await import('node:fs/promises');
  const old = await stat(media[1].sourcePath);
  await utimes(media[1].sourcePath, old.atime, new Date(old.mtimeMs + 2000));
  const requestId = randomUUID();
  await page.evaluate(({ requestId }) => {
    window.__cancelTest = window.__TAURI_INTERNALS__.invoke('prepare_video', { id: 'codec-1', requestId, force: true, preview: false }).then(() => 'completed', e => String(e));
  }, { requestId });
  await invoke('cancel_video', { requestId });
  expect(await page.evaluate(() => window.__cancelTest)).toContain('取消');
  await utimes(media[1].sourcePath, old.atime, old.mtime);
  await expect(invoke('prepare_video', { id: 'unknown', requestId: randomUUID(), force: false, preview: false })).rejects.toThrow(/授权/);
  for (let i = 0; i < media.length; i++) expect(createHash('sha256').update(await readFile(media[i].sourcePath)).digest('hex')).toBe(hashes[i]);
  expect(errors).toEqual([]);
  await writeFile(join(output, 'results.json'), JSON.stringify({ engine: 'Windows WebView2', results, corruptRetryRecovery: true, hoverRelease: true, cancellation: true, unknownMediaRejected: true, originalHashesUnchanged: true, errors }, null, 2));
} finally { await browser.close(); }
