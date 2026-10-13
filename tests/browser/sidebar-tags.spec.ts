import { expect,test } from "../support/browser.fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.settings.reducedMotion = true;
    db.tags = [{ id: 'one', name: '清新', groupId: 'g0' }, { id: 'two', name: '城市', groupId: 'g1' }, { id: 'unused', name: '未使用', groupId: 'g0' }];
    db.media.forEach((item: any) => { item.tags = []; });
    db.albums = db.albums.slice(0, 3);
    db.albums[0].tags = ['one', 'two']; db.albums[1].tags = ['one']; db.albums[2].tags = ['two'];
    // A media-only tag must count and match exactly once per album.
    db.media.find((item: any) => item.id === 'p4').tags = ['one'];
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
});

test('tag clicks toggle independently, reload keeps selections, and clear restores results', async ({ page }) => {
  await page.goto('/#/tags?sort=name&kind=image&page=4');
  const sidebar = page.getByRole('group', { name: '标签筛选', exact: true });
  const one = sidebar.getByRole('button', { name: '清新', exact: true });
  const two = sidebar.getByRole('button', { name: '城市', exact: true });
  await expect(one).toHaveAttribute('data-count', '3');
  await expect(one.locator('.tag-label-icon')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('标签');
  await expect(page.locator('.page-heading p, .tag-sidebar')).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true })).toBeVisible();
  await expect(page.locator('.topbar').getByRole('button', { name: '添加写真', exact: true })).toHaveCount(0);
  await one.click();
  await expect(one).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/sort=name&kind=image/);
  await two.click();
  await expect(one).toHaveAttribute('aria-pressed', 'true');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.album-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '移除标签 清新', exact: true }).locator('.tag-label-icon')).toHaveCount(1);
  expect(await page.locator('.album-caption .chip').evaluateAll(elements => elements.every(element => element.querySelector('.tag-label-icon')))).toBe(true);
  await page.locator('.album-card').first().evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
  await page.screenshot({ path: 'verification/tags-selected-browser.png' });
  await one.click();
  await expect(one).toHaveAttribute('aria-pressed', 'false');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-toolbar').getByRole('button', { name: /^筛选/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '搜索标签' })).toHaveCount(0);
  await one.click();
  await page.reload();
  await expect(one).toHaveAttribute('aria-pressed', 'true');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await two.focus(); await page.keyboard.press('Space');
  await expect(one).toHaveAttribute('aria-pressed', 'true');
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  await sidebar.getByRole('button', { name: '未使用', exact: true }).click();
  await expect(page.getByText('没有找到匹配的写真', { exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: '全部标签', exact: true }).click();
  await expect(page.locator('.album-card')).toHaveCount(3);
  await expect(page).not.toHaveURL(/tag=/);
  await expect(page).toHaveURL(/sort=name&kind=image/);

});

test('new tag opens management draft and narrow layouts stay usable', async ({ page }) => {
  await page.goto('/#/tags');
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(page.getByRole('group', { name: '标签筛选', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(page).toHaveURL(/#\/tags$/);
  await expect(page.getByRole('dialog', { name: '添加标签' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加标签' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
});

test('first tag can be saved from the sidebar without an existing group', async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.tags = []; db.groups = []; db.albums = []; db.media = [];
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.goto('/#/tags');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByRole('combobox', { name: '标签名称', exact: true }).fill('第一个标签');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '标签', exact: true }).click();
  await expect(page.getByRole('group', { name: '标签筛选', exact: true }).getByRole('button', { name: '第一个标签', exact: true })).toBeVisible();
});

test('selected chips remove one condition, models combine with tags, and overflow stays inside the rail', async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.tags.push(...Array.from({ length: 35 }, (_, i) => ({ id: `long-${i}`, name: `较长的标签名称 ${i}`, groupId: 'g0' })));
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.goto('/#/tags');
  const filters = page.getByRole('group', { name: '标签筛选', exact: true });
  await filters.getByRole('button', { name: '清新', exact: true }).click();
  await filters.getByRole('button', { name: '城市', exact: true }).click();
  await page.getByRole('button', { name: '移除标签 清新', exact: true }).click();
  await expect(filters.getByRole('button', { name: '城市', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(filters.getByRole('button', { name: '清新', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await filters.getByRole('button', { name: '筛选模特 林夏', exact: true }).click();
  await expect(page.locator('.library-results small')).toHaveText('1 本写真集');
  await expect(page.getByRole('button', { name: '移除模特 林夏' })).toBeVisible();
  await page.getByRole('button', { name: '清除全部筛选' }).click();
  await expect(page.locator('.album-card')).toHaveCount(3);
  await expect(page).not.toHaveURL(/tag=|model=/);
  for (const width of [1024, 560]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.tag-browse-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  }
  await filters.getByRole('button', { name: '向后浏览筛选项', exact: true }).click();
  expect(await page.locator('.tag-browse-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});
