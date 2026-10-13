import { catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Read-only acceptance against the installed production catalog.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installed = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const isolated = process.env.AURE_TAGS_ISOLATED === '1';
const identifier = isolated ? 'local.jingji.sidebar-tags-test' : 'local.jingji.desktop';
const receipt = JSON.parse((await readFile(join(installed, 'build.json'), 'utf8')).replace(/^\uFEFF/, ''));
const executableHash = createHash('sha256').update(await readFile(isolated ? 'src-tauri/target/debug/aure.exe' : join(installed, 'aure.exe'))).digest('hex').toUpperCase();
if (!isolated) expect(executableHash).toBe(receipt.ExecutableHash);
const db = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const counts = Object.fromEntries(db.prepare("SELECT tag.value id, count(*) total FROM summaries s, json_each(s.data, '$.tags') tag GROUP BY tag.value").all().map(row => [row.id, row.total]));
const tags = db.prepare("SELECT id, data FROM entities WHERE kind='tags' ORDER BY rowid").all().map(row => ({ id: row.id, ...JSON.parse(row.data) }));
const selected = [...tags].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)).slice(0, 2);
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', identifier);
const page = nativePage(browser);
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const output = isolated ? 'verification/sidebar-tags-isolated' : 'verification/sidebar-tags-installed';
try {
  expect(await invoke('plugin:app|identifier')).toBe(identifier);
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('h1')).toHaveText('设置');
  await expect(page.locator('.settings-page').getByRole('heading', { name: '标签', exact: true })).toHaveCount(0);
  await expect(page.locator('.settings-page a[href*="tags"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/tags?sort=name'; });
  const sidebar = page.getByRole('group', { name: '标签筛选', exact: true });
  await expect(page.locator('h1')).toHaveText('标签');
  await expect(page.locator('.page-heading p, .tag-sidebar')).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true })).toBeVisible();
  // Resolve stable IDs, including libraries with duplicate names across groups.
  const tagButtons = selected.map(tag => sidebar.locator(`[data-tag-id="${tag.id.replaceAll('"', '\\"')}"]`));
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '全部标签', exact: true }).locator('.tag-label-icon')).toHaveCount(1);
  await expect.poll(() => sidebar.locator('[data-tag-id]').count()).toBe(tags.length);
  const allView = await invoke('catalog_view', { query: { route: 'library', tagSidebar: true, sort: 'name', limit: 96 } });
  expect(allView.tagAlbumCounts).toEqual(counts);
  let intersection;
  if (selected.length >= 2) {
  for (const button of tagButtons) await expect(button.locator('.tag-label-icon')).toHaveCount(1);
  await tagButtons[0].click();
  await expect(tagButtons[0]).toHaveAttribute('aria-pressed', 'true');
  if ((counts[selected[0].id] || 0) > 96) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Number(await page.locator('.album-grid').getAttribute('data-total-items'))).toBeGreaterThan(96);
    await expect(page.getByRole('navigation', { name: '图库分页' })).toHaveCount(0);
    await expect(sidebar.locator('[data-tag-id]').first()).toHaveAttribute('data-count', String(counts[tags[0].id] || 0));
  }
  await tagButtons[1].click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(tagButtons[0]).toHaveAttribute('aria-pressed', 'true');
  await expect(tagButtons[1]).toHaveAttribute('aria-pressed', 'true');
  intersection = await invoke('catalog_view', { query: { route: 'library', tags: selected.map(tag => tag.id), tagSidebar: true, sort: 'name', limit: 96 } });
  await expect(page.locator('.library-results small')).toHaveText(`${intersection.total} 本写真集`);
  expect(intersection.tagAlbumCounts).toEqual(counts);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).getAll('tag').sort()).toEqual(selected.map(tag => tag.id).sort());
  await expect(page.locator('.library-toolbar').getByRole('button', { name: /^筛选/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '搜索标签' })).toHaveCount(0);
  await tagButtons[0].click();
  await expect(tagButtons[0]).toHaveAttribute('aria-pressed', 'false');
  await expect(tagButtons[1]).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-results small')).toHaveText(`${counts[selected[1].id] || 0} 本写真集`);
  await tagButtons[0].click();
  await expect(page.locator('.library-results small')).toHaveText(`${intersection.total} 本写真集`);
  if (isolated) {
    await sidebar.getByRole('button', { name: '筛选模特 林夏', exact: true }).click();
    const modelView = await invoke('catalog_view', { query: { route: 'library', tags: selected.map(tag => tag.id), model: 'm', tagSidebar: true, sort: 'name', limit: 96 } });
    await expect(page.locator('.library-results small')).toHaveText(`${modelView.total} 本写真集`);
    await expect(tagButtons[0]).toHaveAttribute('aria-pressed', 'true');
    await expect(tagButtons[1]).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '移除模特 林夏', exact: true }).click();
    await expect(page.locator('.library-results small')).toHaveText(`${intersection.total} 本写真集`);
    await page.getByRole('button', { name: `移除标签 ${selected[0].name}`, exact: true }).click();
    await expect(tagButtons[0]).toHaveAttribute('aria-pressed', 'false');
    await expect(tagButtons[1]).toHaveAttribute('aria-pressed', 'true');
    await tagButtons[0].click();
    await expect(page.locator('.library-results small')).toHaveText(`${intersection.total} 本写真集`);
  }
  } else if (!tags.length) {
    await expect(sidebar.getByText('还没有标签', { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '标签', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true })).not.toHaveClass(/active/);
  await expect(page.locator('.picker-pages')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (isolated) await expect.poll(() => page.locator('.album-card .cover-link img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/selected.png` });
  if (intersection) await page.getByRole('button', { name: '清除全部筛选' }).click();
  await expect(page.locator('.library-results small')).toHaveText(`${allView.total} 本写真集`);
  if (isolated) {
    await page.evaluate(() => { location.hash = '#/tags/manage'; });
    await expect(page.locator('.tag-item')).toHaveCount(tags.length);
    expect(await page.locator('.tag-item a').evaluateAll(links => links.every(link => link.querySelector('.tag-label-icon')))).toBe(true);
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '标签', exact: true })).toHaveClass(/active/);
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true })).not.toHaveClass(/active/);
  }
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const report = { installedBuild: !isolated, isolated, engine: 'Windows WebView2', executableHash,
    frontendEntry: receipt.FrontendEntry, tagCount: tags.length, multiSelect: !!intersection, independentToggle: !!intersection,
    filterPanelRemoved: true, intersectionTotal: intersection?.total, fullCatalogCounts: true,
    clear: !!intersection, horizontalFilters: true, titleWithoutSubtitle: true, addTagAction: true,
    removableConditions: isolated, combinedModelFilter: isolated, tagIcons: true, settingsTagEntryRemoved: true,
    catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); await browser.close(); }
