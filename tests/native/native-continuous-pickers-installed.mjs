import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSnapshot, connectNative, nativePage, readInstalledBuild } from '../support/native-session.mjs';

// Production acceptance is read-only; selections are discarded, never saved.
const output = 'verification/continuous-pickers-installed';
const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
await mkdir(output, { recursive: true });
const before = catalogSnapshot(db);
if (process.argv.includes('--snapshot')) {
  await writeFile(`${output}/catalog-before.json`, JSON.stringify({ hash: before }));
  console.log('Read-only catalog snapshot saved.');
  db.close();
  process.exit(0);
}
const receipt = await readInstalledBuild();
const browser = await connectNative('http://127.0.0.1:9237', 'local.jingji.desktop');
const page = nativePage(browser);
try {
  expect(before).toBe(JSON.parse(await readFile(`${output}/catalog-before.json`, 'utf8')).hash);
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { location.hash = '#/models'; });
  await page.locator('.topbar').getByRole('button', { name: '添加模特', exact: true }).click();
  await page.getByRole('button', { name: '关联写真集', exact: true }).click();
  const total = db.prepare("SELECT count(*) count FROM entities WHERE kind='albums'").get().count;
  const rows = page.locator('.album-choices [role=checkbox]');
  if (total) await expect(rows.first()).toBeVisible();
  await expect(page.locator('.picker-pages, input[type=number]')).toHaveCount(0);
  const save = await page.getByRole('button', { name: '保存', exact: true }).boundingBox();
  const cancel = await page.getByRole('button', { name: '取消', exact: true }).boundingBox();
  expect(Math.abs(save.width - cancel.width)).toBeLessThanOrEqual(2);
  expect(save.height).toBe(32);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/editor.png` });
  if (total) {
    const checked = await rows.first().isChecked();
    await rows.first().setChecked(!checked);
    for (let attempt = 0; attempt < Math.ceil(total / 48) + 6; attempt++) {
      if (await rows.count() === total) break;
      await page.locator('.dialog-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(200);
    }
    await expect(rows).toHaveCount(total);
    await expect(rows.first()).toBeChecked({ checked: !checked });
    await rows.last().setChecked(!(await rows.last().isChecked()));
    await page.screenshot({ path: `${output}/last-window.png` });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const favorites = {};
  for (const [tab, kind] of [['albums', 'albums'], ['media', 'media']]) {
    const count = db.prepare('SELECT count(*) count FROM entities WHERE kind=? AND favorite=1').get(kind).count;
    await page.evaluate(tab => { location.hash = `#/favorites?tab=${tab}`; }, tab);
    await expect(page.getByRole('button', { name: `${tab === 'albums' ? '写真集' : '照片与视频'} · ${count}`, exact: true })).toBeVisible();
    if (count) {
      for (let attempt = 0; attempt < Math.ceil(count / 96) + 6; attempt++) {
        if (await page.locator('.virtual-grid').getAttribute('data-total-items') === String(count)) break;
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
      }
      await expect(page.locator('.virtual-grid')).toHaveAttribute('data-total-items', String(count));
    }
    await expect(page.locator('.picker-pages, input[type=number]')).toHaveCount(0);
    favorites[tab] = count;
  }
  await page.evaluate(() => { location.hash = '#/models'; });
  expect(catalogSnapshot(db)).toBe(before);
  expect(errors).toEqual([]);
  const result = { engine: 'installed Windows WebView2', frontendEntry: receipt.FrontendEntry,
    executableHash: receipt.ExecutableHash, albumChoicesReached: total, saveButton: save,
    paginationAbsent: true, selectionsRetained: true, discardedWithoutSaving: true, favorites, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
  await browser.close();
}
