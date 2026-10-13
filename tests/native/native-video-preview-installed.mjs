import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed build: real catalog is read-only; cache generation is allowed.
import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const hashFile = path => new Promise((resolve, reject) => {
  const hash = createHash('sha256'); const stream = createReadStream(path);
  stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex').toUpperCase())); stream.on('error', reject);
});
const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(installed);

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const source = db.prepare("SELECT e.id,json_extract(e.data,'$.sourcePath') path,r.owner album FROM entities e JOIN refs r ON r.target=e.id AND r.owner_kind='albums' JOIN authorized a ON a.path=e.source WHERE e.kind='media' AND e.media_kind='video' ORDER BY CASE WHEN json_extract(e.data,'$.name')='83.mp4' THEN 0 ELSE 1 END LIMIT 1").get();
if (!source) throw Error('No authorized real video');
const originalHash = await hashFile(source.path);
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
try {
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  // Do not navigate into albums or change settings in the formal catalog.
  // The isolated native test covers global propagation and card playback.
  await expect(page.locator('.video-cover-trigger')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/settings'; });
  const setting = page.getByRole('combobox', { name: '视频封面取帧位置' });
  const settings = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value);
  await expect(setting).toHaveValue(String(settings.videoPosterPercent ?? 10));
  await expect(setting.locator('option')).toHaveText(['前段', '中段', '后段']);
  await setting.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'verification/video-preview/installed-cover-settings.png' });
  expect(await hashFile(source.path)).toBe(originalHash);
  expect(snapshot()).toBe(before);
  const result = { engine: 'installed Windows WebView2', executableHash: receipt.ExecutableHash, frontendEntry: receipt.FrontendEntry, globalCoverSettingVisible: true, positions: ['前段', '中段', '后段'], catalogUnchanged: true, originalHashUnchanged: true };
  await writeFile('verification/video-preview/installed-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close(); await browser.close();
}
