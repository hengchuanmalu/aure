import { expect, test, type Page } from '../support/browser.fixture';
import { seedFixture } from '../support/demo.fixture';

async function maintenanceFixture(page: Page, delayedPrepare = false, delayedConfirm = false, rejectConfirm = false, cancelFailures = 0) {
  const fixture = seedFixture();
  fixture.media[0].sourcePath = 'D:/disposable/photo.jpg';
  await page.addInitScript(({ fixture, delayedPrepare, delayedConfirm, rejectConfirm, cancelFailures }) => {
    const w = window as any;
    w.__maintenanceCalls = [];
    let cancellations = 0;
    w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string, args: any = {}) => {
        w.__maintenanceCalls.push({ command, args });
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_recent') return [];
        if (command === 'plugin:window|is_fullscreen') return false;
        if (command === 'plugin:window|set_fullscreen') return;
        if (command === 'catalog_candidates') return { items: fixture.media, total: fixture.media.length };
        if (command === 'image_thumbnail') return fixture.media[0].src;
        if (command === 'read_media_metadata') return { width: 1600, height: 1067, exif: {} };
        if (command === 'prepare_catalog_restore' || command === 'prepare_media_relink') {
          const plan = command === 'prepare_catalog_restore'
            ? { token: 'restore-plan', name: 'disposable.sqlite3', albums: 2, models: 1, media: 3 }
            : { token: 'relink-plan', name: 'replacement.jpg', previousName: 'photo.jpg', path: 'D:/disposable/replacement.jpg' };
          if (delayedPrepare) return new Promise(resolve => { w.__releaseMaintenancePrepare = () => resolve(plan); });
          return plan;
        }
        if (command === 'cancel_catalog_maintenance') {
          if (++cancellations <= cancelFailures) throw Error('Synthetic temporary file lock');
          return;
        }
        if (command === 'confirm_catalog_restore' || command === 'confirm_media_relink') {
          if (delayedConfirm) return new Promise((resolve, reject) => {
            w.__releaseMaintenanceConfirm = () => rejectConfirm ? reject(Error('Synthetic commit failure')) : resolve(undefined);
          });
          return;
        }
        if (command === 'catalog_view') {
          const album = fixture.albums[0];
          const index = album.mediaIds.indexOf(args.query.id);
          return { db: structuredClone(fixture), page: 0, limit: 96, total: fixture.albums.length,
            albumTotal: fixture.albums.length, modelTotal: fixture.models.length,
            mediaTotal: fixture.media.length, mediaCount: fixture.media.length, visibleMediaIds: album.mediaIds,
            viewer: args.query.route === 'viewer' ? { index, total: album.mediaIds.length, previous: album.mediaIds[index - 1], next: album.mediaIds[index + 1] } : undefined };
        }
        throw Error(`Unexpected native call: ${command}`);
      },
    };
  }, { fixture, delayedPrepare, delayedConfirm, rejectConfirm, cancelFailures });
}

const canceled = (page: Page) => page.evaluate(() => (window as any).__maintenanceCalls.filter((call: any) => call.command === 'cancel_catalog_maintenance').map((call: any) => call.args.token));

for (const delayed of [false, true]) {
  test(`leaving Settings releases its restore plan ${delayed ? 'when delayed preparation returns' : 'while the preview is open'}`, async ({ page }) => {
    await maintenanceFixture(page, delayed);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '选择备份', exact: true }).click();
    if (delayed) await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseMaintenancePrepare)).toBe('function');
    else await expect(page.getByRole('dialog', { name: '恢复图库备份？', exact: true })).toBeVisible();
    await page.evaluate(() => { location.hash = '/library'; });
    await expect(page.getByRole('heading', { name: '写真库', exact: true })).toBeVisible();
    if (delayed) await page.evaluate(() => (window as any).__releaseMaintenancePrepare());
    await expect.poll(() => canceled(page)).toEqual(['restore-plan']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test(`leaving media information releases its relink plan ${delayed ? 'when delayed preparation returns' : 'while the preview is open'}`, async ({ page }) => {
    await maintenanceFixture(page, delayed);
    await page.goto('/#/viewer/a0/p0');
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '媒体信息', exact: true }).click();
    await page.getByRole('button', { name: '重新关联文件', exact: true }).click();
    if (delayed) {
      await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseMaintenancePrepare)).toBe('function');
      await page.getByRole('button', { name: '关闭信息', exact: true }).click();
      await expect(page.locator('.info-panel')).toHaveCount(0);
      await page.evaluate(() => (window as any).__releaseMaintenancePrepare());
    } else {
      await expect(page.getByRole('dialog', { name: '重新关联媒体文件？', exact: true })).toBeVisible();
      await page.evaluate(() => { location.hash = '/library'; });
      await expect(page.getByRole('heading', { name: '写真库', exact: true })).toBeVisible();
    }
    await expect.poll(() => canceled(page)).toEqual(['relink-plan']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

for (const rejected of [false, true]) {
  test(`an in-flight restore left by navigation ${rejected ? 'releases its plan after failure' : 'finishes without canceling the committed plan'}`, async ({ page }) => {
    await maintenanceFixture(page, false, true, rejected);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '选择备份', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '恢复备份', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseMaintenanceConfirm)).toBe('function');
    await page.evaluate(() => { location.hash = '/library'; });
    await expect(page.getByRole('heading', { name: '写真库', exact: true })).toBeVisible();
    expect(await canceled(page)).toEqual([]);
    await page.evaluate(() => (window as any).__releaseMaintenanceConfirm());
    if (rejected) await expect.poll(() => canceled(page)).toEqual(['restore-plan']);
    else {
      await expect.poll(() => page.evaluate(() => (window as any).__maintenanceCalls.filter((call: any) => call.command === 'catalog_view').length)).toBeGreaterThanOrEqual(3);
      expect(await canceled(page)).toEqual([]);
    }
  });
}

test('temporary preview cleanup failure retries the same token within a finite budget', async ({ page }) => {
  await maintenanceFixture(page, false, false, false, 2);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '选择备份', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => canceled(page)).toEqual(['restore-plan', 'restore-plan', 'restore-plan']);
  await expect(page.locator('.toast[role="status"]')).toHaveCount(0);
});

test('cleanup that still fails after three attempts reports the abandoned preview issue', async ({ page }) => {
  await maintenanceFixture(page, false, false, false, 99);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '选择备份', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => { location.hash = '/library'; });
  await expect(page.getByRole('heading', { name: '写真库', exact: true })).toBeVisible();
  await expect.poll(() => canceled(page)).toEqual(['restore-plan', 'restore-plan', 'restore-plan']);
  await expect(page.locator('.toast[role="status"]')).toHaveText('临时预览清理失败，请检查磁盘连接或文件占用');
});

test('double confirmation of one preview shares one native commit', async ({ page }) => {
  await maintenanceFixture(page, false, true);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '选择备份', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复备份', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseMaintenanceConfirm)).toBe('function');
  expect(await page.evaluate(() => (window as any).__maintenanceCalls.filter((call: any) => call.command === 'confirm_catalog_restore').length)).toBe(1);
  await page.evaluate(() => (window as any).__releaseMaintenanceConfirm());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await canceled(page)).toEqual([]);
});
