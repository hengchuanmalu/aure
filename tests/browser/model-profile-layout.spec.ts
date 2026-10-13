import { expect,test } from "../support/browser.fixture";

test('avatar, name, fading text and bottom collapse stay left of the cover', async ({ page }) => {
  await page.goto('/#/models/m0');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    Object.assign(db.models[0], {
      alias: '周慕汐', name: '鱼子酱fish',
      bio: '第一段完整简介。\n第二段简介。\n第三段简介。\n第四段简介。',
      fields: [
        { id: 'height', group: '详细资料', label: '身高', value: '162 cm' },
        { id: 'birth', group: '详细资料', label: '生日', value: '1995-02-19' },
        { id: 'region', group: '详细资料', label: '地区', value: '上海' },
        { id: 'blank', group: '空分组', label: '留空', value: '' },
      ], links: [{ label: 'Twitter', url: 'https://x.com/example' }],
    });
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  const hero = page.getByRole('region', { name: '模特资料', exact: true });
  const content = hero.locator('.profile-content');
  const toggle = hero.locator('.profile-expand');
  const bounds = async (selector: string) => (await hero.locator(selector).boundingBox())!;
  for (const width of [1440, 1024, 800, 603, 500]) {
    await page.setViewportSize({ width, height: 960 });
    const avatar = await bounds('.profile-image-trigger');
    const title = await bounds('h1');
    const image = await bounds('.model-backdrop');
    const text = await bounds('.profile-content');
    expect(title.x).toBeGreaterThanOrEqual(avatar.x + avatar.width + 15);
    expect(title.y).toBeLessThan(avatar.y + avatar.height);
    expect(title.y + title.height).toBeGreaterThan(avatar.y);
    if (width > 540) {
      expect(text.x + text.width).toBeLessThan(image.x);
    }
    expect(text.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(text.x).toBeCloseTo(avatar.x, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1024, height: 960 });
  const original = await page.evaluate(() => localStorage.getItem('jingji.mock.v1'));
  await expect(hero.getByRole('heading', { name: '详细资料', exact: true })).toHaveCount(0);
  await expect(hero.locator('.profile-field')).toHaveCount(3);
  await expect(hero.getByText('空分组', { exact: true })).toHaveCount(0);
  await expect(content).toHaveAttribute('inert', '');
  await expect(content).toHaveCSS('mask-image', /linear-gradient/);
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'verification/model-profile/approved-collapsed.png', fullPage: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('收起');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(content).not.toHaveAttribute('inert', '');
  expect(await content.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect(hero.getByText('162 cm', { exact: true })).toBeVisible();
  await expect(hero.getByText('1995-02-19', { exact: true })).toBeVisible();
  const text = await bounds('.profile-content');
  const action = await bounds('.profile-content-actions');
  const image = await bounds('.model-backdrop');
  expect(action.x + action.width).toBeLessThan(image.x);
  expect(action.y).toBeGreaterThanOrEqual(text.y + text.height);
  expect(action.y - text.y - text.height).toBeLessThanOrEqual(4);
  const link = hero.getByRole('link', { name: 'Twitter', exact: true });
  await expect(link).toHaveAttribute('href', 'https://x.com/example');
  await link.focus();
  await expect(content).toHaveCSS('mask-image', 'none');
  await toggle.focus();
  await expect(content).toHaveCSS('mask-image', /linear-gradient/);
  await page.screenshot({ path: 'verification/model-profile/approved-expanded.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  await expect(toggle).toHaveText('展开更多');
  await expect(content).toHaveAttribute('inert', '');
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('jingji.mock.v1'))).toBe(original);
});

test('field-only profile matches the approved text lines and left-column control', async ({ page }) => {
  await page.goto('/#/models/m0');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    Object.assign(db.models[0], { bio: '', links: [], fields: [
      { id: 'height', group: '', label: '身高', value: '162 cm' },
      { id: 'birthday', group: '', label: '生日', value: '1995-02-19' },
      { id: 'region', group: '', label: '地区', value: '上海' },
      { id: 'weight', group: '', label: '体重', value: '46 kg' },
      { id: 'measurements', group: '', label: '三围', value: 'B86 / W59 / H88' },
    ] });
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  const hero = page.getByRole('region', { name: '模特资料', exact: true });
  await hero.getByRole('button', { name: '展开更多', exact: true }).click();
  await expect(hero.locator('.profile-field')).toHaveText(['身高：162 cm', '生日：1995-02-19', '地区：上海', '体重：46 kg', '三围：B86 / W59 / H88']);
  await expect(hero.locator('dl')).toHaveCount(0);
  await page.mouse.click(800, 100);
  await page.screenshot({ path: 'verification/model-profile/approved-fields.png', fullPage: true });
});

test('short and empty content omit ineffective controls and missing background has no panel', async ({ page }) => {
  await page.goto('/#/models/m0');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    Object.assign(db.models[0], { background: '', bio: '简短简介', fields: [], links: [] });
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  const hero = page.getByRole('region', { name: '模特资料', exact: true });
  await expect(hero.locator('.model-backdrop')).toHaveCount(0);
  await expect(hero.locator('.profile-expand')).toHaveCount(0);
  await expect(hero.locator('.biography')).toHaveText('简短简介');
  await expect(hero.locator('.profile-content')).toHaveCSS('mask-image', 'none');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.models[0].bio = '';
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  await expect(hero.locator('.model-description')).toHaveCount(0);
});
