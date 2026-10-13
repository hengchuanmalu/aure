import { expect } from '@playwright/test';
import { dirname } from 'node:path';

/** The caller seeds copied synthetic media and runs checks serially. */
export async function checkBrowsingJourneys(page, invoke, createAuditMedia) {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.user-journey-audit');
  const checks = {};
  const navigate = route => page.evaluate(route => { location.hash = route; }, route);
  const navigation = page.getByRole('navigation', { name: '主导航' });

  await navigate('/recent');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
  expect((await invoke('catalog_view', { query: { route: 'recent' } })).total).toBe(0);
  await navigation.getByRole('link', { name: '写真库', exact: true }).click();
  await page.getByRole('link', { name: '打开写真 城市漫游', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('城市漫游');
  await expect.poll(async () => (await invoke('catalog_view', { query: { route: 'recent' } })).total).toBe(1);
  await navigation.getByRole('link', { name: '最近浏览', exact: true }).click();
  await expect(page.locator('.album-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '打开写真 城市漫游', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
  checks.recentClearsAndNewVisitReplacesCachedList = true;

  await navigation.getByRole('link', { name: '发现', exact: true }).click();
  const recentShelf = page.locator('.rail-section').filter({ has: page.getByRole('heading', { name: '最近浏览', exact: true }) });
  await expect(recentShelf).toContainText('打开一组写真，下次从这里继续。');
  await navigation.getByRole('link', { name: '写真库', exact: true }).click();
  await page.getByRole('link', { name: '打开写真 把夏天留下', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('把夏天留下');
  await expect.poll(async () => (await invoke('catalog_view', { query: { route: 'recent' } })).db.recent[0]?.albumId).toBe('a2');
  await navigation.getByRole('link', { name: '发现', exact: true }).click();
  await expect(recentShelf.getByRole('link', { name: '打开写真 把夏天留下', exact: true })).toBeVisible();
  checks.discoveryRecentShelfRefreshes = true;

  await navigate('/favorites?view=cover&tab=albums');
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.getByRole('link', { name: '打开写真 光落在肩上', exact: true }).click();
  await page.getByRole('button', { name: '返回收藏', exact: true }).click();
  await expect(page).toHaveURL(/#\/favorites\?view=cover&tab=albums$/);
  await expect(page.getByRole('button', { name: '封面视图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^照片与视频 ·/ }).click();
  await expect(page.locator('.media-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /^照片与视频 ·/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.media-card .media-open').first().click();
  await expect(page.locator('.viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^照片与视频 ·/ })).toHaveAttribute('aria-pressed', 'true');
  checks.favoriteTabViewAndViewerReturnPersist = true;

  await page.evaluate(() => {
    const originalFetch = window.fetch;
    const audit = { originalFetch, reads: [], historyWrites: 0, groupWrites: 0, failHistoryRefresh: false, failGroupRefresh: false, failNextRead: false };
    window.__browsingJourneyAudit = audit;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1));
        let args;
        try { args = JSON.parse(typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body)); } catch { /* Non-JSON IPC passes through. */ }
        if (command === 'catalog_view') {
          audit.reads.push(args?.query);
          if (audit.failNextRead) {
            audit.failNextRead = false;
            return new Response(JSON.stringify('原生验收：写入成功后的首次读取失败'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } });
          }
        }
        if (command === 'catalog_recent') {
          audit.historyWrites++;
          if (!args?.entry && audit.failHistoryRefresh) {
            audit.failHistoryRefresh = false;
            const response = await originalFetch.call(window, input, options);
            audit.failNextRead = true;
            return response;
          }
        }
        if (command === 'catalog_patch' && args?.changes?.groups?.some(group => group.name === '已保存读取失败验收')) {
          audit.groupWrites++;
          if (audit.failGroupRefresh) {
            audit.failGroupRefresh = false;
            const response = await originalFetch.call(window, input, options);
            audit.failNextRead = true;
            return response;
          }
        }
      }
      return originalFetch.call(window, input, options);
    };
  });
  try {
    await navigate('/recent');
    await expect(page.locator('.album-card').first()).toBeVisible();
    await page.evaluate(() => { window.__browsingJourneyAudit.failHistoryRefresh = true; });
    const historyWritesBefore = await page.evaluate(() => window.__browsingJourneyAudit.historyWrites);
    await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
    const historyAlert = page.locator('.toast[role="alert"]');
    await expect(historyAlert).toContainText('浏览记录已保存，但刷新失败');
    expect((await invoke('catalog_view', { query: { route: 'recent' } })).total).toBe(0);
    await historyAlert.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByText('还没有浏览记录', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__browsingJourneyAudit.historyWrites)).toBe(historyWritesBefore + 1);
    checks.historyReadFailureRetriesWithoutRepeatingWrite = true;

    await navigate('/tags/manage');
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('已保存读取失败验收');
    await page.evaluate(() => { window.__browsingJourneyAudit.failGroupRefresh = true; });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const groupAlert = page.locator('.toast[role="alert"]');
    await expect(groupAlert).toContainText('更改已保存，但刷新失败');
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('已保存读取失败验收');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('保存失败，请重试');
    expect(await page.evaluate(() => window.__browsingJourneyAudit.groupWrites)).toBe(1);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await groupAlert.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('heading', { name: /已保存读取失败验收/ })).toBeVisible();
    expect((await invoke('catalog_view', { query: { route: 'tags' } })).db.groups.filter(group => group.name === '已保存读取失败验收')).toHaveLength(1);
    checks.committedGroupReadFailurePreventsDuplicateSave = true;

    const template = await invoke('catalog_entity', { kind: 'albums', id: 'a0' });
    delete template._summary;
    delete template.sourceDirectory;
    const initialCount = (await invoke('catalog_view', { query: { route: 'library' } })).total;
    for (let index = initialCount; index < 205; index++) {
      await invoke('catalog_operation', { op: { type: 'saveAlbum', album: { ...template, id: `journey-window-${index}`, name: `窗口回归 ${String(index).padStart(3, '0')}`, favorite: false } } });
    }
    // New operations are outside React; discard its old query windows first.
    await navigate('/settings');
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('jingji:catalog-changed')));
    await page.evaluate(() => { window.__browsingJourneyAudit.reads = []; });
    await navigate('/library?sort=name&order=asc&view=cover');
    const reachEnd = async (selector, total) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (Number(await page.locator(selector).getAttribute('data-total-items')) === total) break;
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(120);
      }
      await expect(page.locator(selector)).toHaveAttribute('data-total-items', String(total));
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    };
    await reachEnd('.album-grid', 205);
    await page.locator('.album-card .cover-link').last().click();
    await page.getByRole('button', { name: '返回写真库', exact: true }).click();
    await expect(page.locator('.album-grid')).toHaveAttribute('data-total-items', '205');
    const libraryReads = await page.evaluate(() => window.__browsingJourneyAudit.reads.filter(query => query?.route === 'library').map(query => query.page));
    expect(libraryReads).toEqual([0, 1, 2]);
    checks.continuousLibrary = { total: 205, reads: libraryReads, retainedOnReturn: true };

    const image = await invoke('catalog_entity', { kind: 'media', id: 'p0' });
    const media = await createAuditMedia(image, 'journey-content', 215);
    const album = { ...template, id: 'journey-content', name: '连续媒体窗口验收', mediaIds: media.map(item => item.id), cover: media[0].src, coverMediaId: media[0].id,
      sourceDirectory: dirname(image.sourcePath), favorite: false };
    await invoke('catalog_operation', { op: { type: 'importPrepared', album, media, models: [], groups: [], tags: [], importRules: [] } });
    await navigate('/album/journey-content');
    await reachEnd('.media-layout', 215);
    const lastImage = page.locator('[data-media-id="journey-content-212"] .media-open');
    await lastImage.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const audit = window.__browsingJourneyAudit;
      audit.grid = document.querySelector('.media-layout');
      audit.albumReads = audit.reads.filter(query => query?.route === 'album' && query.id === 'journey-content').length;
      document.addEventListener('pointerdown', () => { audit.scroll = scrollY; }, { once: true, capture: true });
    });
    await lastImage.click();
    await expect(page.locator('.viewer')).toBeVisible();
    await expect.poll(() => page.locator('.media-stage > img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.viewer')).toHaveCount(0);
    const retained = await page.evaluate(() => {
      const audit = window.__browsingJourneyAudit;
      return { sameNode: audit.grid === document.querySelector('.media-layout'), scrollDelta: scrollY - audit.scroll,
        readsBefore: audit.albumReads, readsAfter: audit.reads.filter(query => query?.route === 'album' && query.id === 'journey-content').length };
    });
    expect(retained.sameNode).toBe(true);
    expect(Math.abs(retained.scrollDelta)).toBeLessThan(1);
    expect(retained.readsBefore).toBe(3);
    expect(retained.readsAfter).toBe(3);
    checks.continuousMedia = { total: 215, ...retained };
  } finally {
    await page.evaluate(() => {
      if (window.__browsingJourneyAudit) { window.fetch = window.__browsingJourneyAudit.originalFetch; delete window.__browsingJourneyAudit; }
    });
  }
  return checks;
}
