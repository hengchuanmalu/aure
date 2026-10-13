import { expect,test } from "../support/browser.fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    const template = db.albums[0];
    db.albums = ['Charlie', 'Alpha', 'Bravo'].map((name, index) => ({
      ...template, id: `sort-${index}`, name,
      createdAt: `2026-10-0${index + 1}`, updatedAt: `2026-10-0${3 - index}`,
    }));
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
});

for (const route of ['library', 'tags']) {
  test(`${route} switching sort fields keeps the same menu open`, async ({ page }) => {
    await page.goto(`/#/${route}?view=cover&model=m0&sort=updated&order=asc`);
    const trigger = page.getByRole('button', { name: '排序', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu', { name: '排序选项' });
    await menu.evaluate(element => { (window as any).__originalSortMenu = element; });
    await menu.getByRole('menuitemradio', { name: '创建日期', exact: true }).click();
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL(/sort=created&order=desc/);
    await expect.poll(() => page.locator('.album-card h3').allTextContents()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    await expect(menu.getByRole('menuitemradio', { name: '创建日期', exact: true })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: '名称排序', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL(/sort=name&order=asc/);
    await expect.poll(() => page.locator('.album-card h3').allTextContents()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(await menu.evaluate(element => element === (window as any).__originalSortMenu)).toBe(true);
    await menu.getByRole('menuitemradio', { name: '名称排序', exact: true }).click();
    await expect(page).toHaveURL(/sort=name&order=desc/);
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(300, 180);
    await expect(menu).toBeHidden();
  });

  test(`${route} one click toggles a single clockwise arrow and the actual sort order`, async ({ page }) => {
    const names = () => page.locator('.album-card h3').allTextContents();
    const sorts = [
      { label: '最近更新', value: 'updated', asc: ['Bravo', 'Alpha', 'Charlie'] },
      { label: '创建日期', value: 'created', asc: ['Charlie', 'Alpha', 'Bravo'] },
      { label: '名称排序', value: 'name', asc: ['Alpha', 'Bravo', 'Charlie'] },
    ];
    for (const sort of sorts) {
      await page.goto(`/#/${route}?view=cover&model=m0&sort=${sort.value}&order=desc`);
      await page.getByRole('button', { name: '排序', exact: true }).click();
      const menu = page.getByRole('menu', { name: '排序选项' });
      const item = menu.getByRole('menuitemradio', { name: sort.label, exact: true });
      const arrow = item.locator('.sort-arrow');
      await expect(menu.locator('.lucide-check')).toHaveCount(0);
      await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
      await expect(menu.locator('.sort-arrow')).toHaveCount(1);
      await expect(menu.locator('.sort-direction')).toHaveCount(0);
      await expect(arrow).toHaveAttribute('data-direction', 'desc');
      const initialAngle = await arrow.evaluate(element => parseFloat(element.style.transform.replace('rotate(', '')));
      await item.click();
      await expect(menu).toBeVisible();
      await expect(arrow).toHaveAttribute('data-direction', 'asc');
      await expect.poll(names).toEqual(sort.asc);
      await expect(page).toHaveURL(new RegExp(`sort=${sort.value}&order=asc`));
      expect(await arrow.evaluate(element => parseFloat(element.style.transform.replace('rotate(', '')))).toBe(initialAngle + 180);
      await expect.poll(() => arrow.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
      await item.click();
      await expect(arrow).toHaveAttribute('data-direction', 'desc');
      await expect.poll(names).toEqual([...sort.asc].reverse());
      expect(await arrow.evaluate(element => parseFloat(element.style.transform.replace('rotate(', '')))).toBe(initialAngle + 360);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '排序', exact: true })).toBeFocused();
    }
    await page.reload();
    await expect.poll(names).toEqual(['Charlie', 'Bravo', 'Alpha']);
    await page.getByRole('button', { name: '排序', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '名称排序', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(names).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('menuitemradio', { name: '名称排序', exact: true }).click();
    await expect(page.locator('.sort-arrow')).toHaveAttribute('data-direction', 'desc');
    expect(await page.locator('.sort-arrow').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  });
}

test('native sorting retains the menu and arrow during a pending catalog refresh', async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === 'catalog_initialize') return false;
        if (command === 'catalog_view') {
          await new Promise(resolve => setTimeout(resolve, 80));
          const snapshot = structuredClone(db);
          snapshot.albums.sort((a: any, b: any) => args.query.order === 'asc'
            ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
          return { db: snapshot, page: 0, limit: 96, total: 3, albumTotal: 3, modelTotal: snapshot.models.length, mediaTotal: 0, mediaCount: snapshot.media.length };
        }
        throw Error(`Unexpected native call: ${command}`);
      },
    };
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: '排序', exact: true }).click();
  const menu = page.getByRole('menu', { name: '排序选项' });
  await menu.locator('.sort-arrow').evaluate(element => { (window as any).__originalArrow = element; });
  await menu.getByRole('menuitemradio', { name: '最近更新', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect.poll(() => page.locator('.album-card h3').allTextContents()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  expect(await menu.locator('.sort-arrow').evaluate(element => element === (window as any).__originalArrow)).toBe(true);
  await expect(menu.locator('.sort-arrow')).toHaveAttribute('data-direction', 'asc');
});
