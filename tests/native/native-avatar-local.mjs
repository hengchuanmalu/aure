import { connectNative, nativePage } from '../support/native-session.mjs';
// Continue after choosing verification/avatar-native/files/local-avatar.jpg in the native picker.
import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const browser = await connectNative('http://127.0.0.1:9241', "local.jingji.avatar-test");
try {
  const page = nativePage(browser);
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.avatar-test');
  const localPath = resolve('verification/avatar-native/files/local-avatar.jpg');
  const originalHash = createHash('sha256').update(await readFile(localPath)).digest('hex');
  await expect(page.locator('.avatar-local-selection')).toContainText('local-avatar.jpg');
  await expect(page.getByLabel('头像缩放')).toHaveValue('100');
  await expect.poll(() => page.locator('.avatar-crop-stage img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const before = await invoke('catalog_entity', { kind: 'models', id: 'avatar-model' });
  expect(before.avatarCrop.zoom).toBe(1.65);
  await page.getByLabel('头像缩放').fill('145');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await invoke('catalog_entity', { kind: 'models', id: 'avatar-model' });
  expect(after.avatarCrop.zoom).toBe(1.45);
  const mediaId = decodeURIComponent(after.avatar.split('/media/')[1]);
  const candidate = await invoke('catalog_candidates', { kind: 'media', page: 0, query: { kind: 'image' } });
  expect(candidate.total).toBe(336);
  expect(candidate.items.find(item => item.id === mediaId).sourcePath).toContain('local-avatar.jpg');
  await page.reload();
  await expect.poll(() => page.locator('.profile-avatar img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(createHash('sha256').update(await readFile(localPath)).digest('hex')).toBe(originalHash);
  const report = JSON.parse(await readFile('verification/avatar-native/results.json', 'utf8'));
  await writeFile('verification/avatar-native/results.json', JSON.stringify({ ...report, nativeFilePicker: true, localImagePreview: true, localImageRegistrationOnSave: true, localImageReload: true, localOriginalHashUnchanged: true }, null, 2));
  console.log('Native file selection, draft preview, registration on Save and reload passed; local original unchanged.');
} finally { await browser.close(); }
