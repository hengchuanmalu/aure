import { expect,test } from "../support/browser.fixture";

test('shelf scrolls continuously, keeps cards mounted, and handles rapid clicks and resizing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const snapshot = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    snapshot.recent = snapshot.albums.slice(0, 8).map((album: { id: string }) => ({ albumId: album.id, at: '2026-10-07' }));
    localStorage.setItem('jingji.mock.v1', JSON.stringify(snapshot));
  });
  await page.goto('/');
  const shelf = page.getByRole('region', { name: '图集展台' });
  const rail = shelf.locator('.shelf-rail');
  const previous = shelf.getByRole('button', { name: '上一组图集' });
  const next = shelf.getByRole('button', { name: '下一组图集' });
  await expect(shelf.locator('.shelf-position')).toHaveCount(0);
  const updated = page.locator('.rail-section').filter({ has: page.getByRole('heading', { name: '最近更新', exact: true }) });
  const actions = (section: typeof shelf) => section.locator('.section-title > .row').evaluate(row => ({
    gap: getComputedStyle(row).gap,
    children: [...row.children].map(child => ({ tag: child.tagName, fontSize: getComputedStyle(child).fontSize, width: child.getBoundingClientRect().width, height: child.getBoundingClientRect().height })),
  }));
  expect(await actions(shelf)).toEqual(await actions(updated));
  expect(await shelf.locator('.section-title > .row').evaluate(row => [...row.children].map(child => child.textContent || child.getAttribute('aria-label')))).toEqual(['查看全部', '上一组图集', '下一组图集']);
  for (const title of ['最近更新', '最近浏览']) {
    const section = page.locator('.rail-section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const track = section.locator('.rail');
    await expect(track).toHaveCSS('scrollbar-width', 'none');
    await expect(track).toHaveCSS('overflow-x', 'auto');
    expect(await track.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').display)).toBe('none');
    await section.getByRole('button', { name: `${title} 向右滚动` }).click();
    await expect.poll(() => track.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await section.screenshot({ path: `test-results/${title}-hidden-scrollbar.png` });
  }
  await rail.scrollIntoViewIfNeeded();
  const offset = () => rail.evaluate(el => {
    const groups = [...el.children] as HTMLElement[];
    const active = groups.find(group => !group.inert)!;
    return Math.abs(el.scrollLeft - active.offsetLeft + groups[0].offsetLeft);
  });
  await rail.evaluate(el => {
    (window as any).__firstShelfCard = el.querySelector('.album-card');
    (window as any).__shelfScrollSamples = [];
    el.addEventListener('scroll', () => (window as any).__shelfScrollSamples.push(el.scrollLeft), { passive: true });
  });
  await next.click();
  await expect.poll(offset).toBeLessThanOrEqual(1);
  const samples = await page.evaluate(() => (window as any).__shelfScrollSamples as number[]);
  const final = await rail.evaluate(el => el.scrollLeft);
  expect(samples.some(left => left > 0 && left < final - 1)).toBe(true);
  expect(await rail.evaluate(el => el.querySelector('.album-card') === (window as any).__firstShelfCard)).toBe(true);
  await expect(shelf.getByRole('link', { name: /^打开写真/ })).toHaveCount(4);
  await previous.click();
  await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBe(0);
  await next.dblclick();
  await expect(rail.locator('.shelf-grid:not([inert])')).toHaveCount(1);
  await expect.poll(() => rail.evaluate(el => [...el.children].findIndex(group => !(group as HTMLElement).inert))).toBe(2);
  await expect.poll(offset).toBeLessThanOrEqual(1);
  await expect(next).toBeDisabled();
  for (const width of [1024, 800, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(offset).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => rail.evaluate(el => [...el.children].findIndex(group => !(group as HTMLElement).inert))).toBe(1);
  await expect.poll(offset).toBeLessThanOrEqual(1);
  // Direct horizontal scrolling must synchronize controls and keyboard access.
  await rail.evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
  await expect(previous).toBeDisabled();
});

for (const mode of ['system', 'app'] as const) {
  test(`${mode} reduced motion positions the entire group immediately`, async ({ page }) => {
    if (mode === 'system') await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (mode === 'app') {
      await page.goto('/#/settings');
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
      await page.getByRole('switch', { name: '减少动态效果' }).check();
    }
    await page.goto('/');
    const shelf = page.getByRole('region', { name: '图集展台' });
    const rail = shelf.locator('.shelf-rail');
    if (mode === 'system') await page.emulateMedia({ reducedMotion: 'reduce' });
    await shelf.getByRole('button', { name: '下一组图集' }).click();
    const delta = await rail.evaluate(el => {
      const groups = [...el.children] as HTMLElement[];
      return Math.abs(el.scrollLeft - groups[1].offsetLeft + groups[0].offsetLeft);
    });
    expect(delta).toBeLessThanOrEqual(1);
    await expect(rail.locator('.shelf-grid:not([inert])')).toHaveCount(1);
    expect(await rail.evaluate(el => [...el.children].findIndex(group => !(group as HTMLElement).inert))).toBe(1);
  });
}
