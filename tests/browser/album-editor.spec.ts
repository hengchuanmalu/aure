import { expect,test } from "../support/browser.fixture";
import { expectCoverWindowMatchesBanner } from '../support/cover-crop.mjs';

test('banner window matches saved portrait and wide crops across zoom, edges and resize', async ({ page }) => {
  await page.route('**/crop-source.svg', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="500"><rect width="2400" height="500" fill="#9ac"/></svg>' }));
  await page.goto('/#/album/a0');
  for (const [source, saved] of [
    ['/tests/fixtures/media/p-1382731.jpg', undefined],
    ['/tests/fixtures/media/p-1382731.jpg', { x: 31, y: 72, zoom: 1.6 }],
    ['/tests/fixtures/media/p-1382731.jpg', { x: 100, y: 100, zoom: 3 }],
    ['/crop-source.svg', { x: 0, y: 0, zoom: 1 }],
    ['/crop-source.svg', { x: 68, y: 23, zoom: 2 }],
  ] as const) {
    await page.evaluate(({ source, saved }) => {
      const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
      db.albums[0].cover = source;
      db.albums[0].coverCrop = saved;
      localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
    }, { source, saved });
    await page.reload();
    await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
    await expectCoverWindowMatchesBanner(page);
    for (const viewport of [{ width: 1024, height: 720 }, { width: 600, height: 850 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(viewport);
      await expectCoverWindowMatchesBanner(page);
    }
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].coverCrop)).toEqual(saved);
  }
});

test('drag and wheel adjust the masked crop, save persists it and cancel leaves it unchanged', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.locator('.cover-crop-window')).toBeVisible();
  const stage = page.locator('.cover-crop-stage');
  const window = await page.locator('.cover-crop-window').boundingBox();
  await page.mouse.move(window!.x + window!.width / 2, window!.y + window!.height / 2);
  await page.mouse.down();
  await page.mouse.move(window!.x + window!.width / 2, window!.y + window!.height / 2 + 30);
  await page.mouse.up();
  expect((await page.locator('.cover-crop-window').boundingBox())!.y).toBeGreaterThan(window!.y + 25);
  const scroll = await page.locator('.dialog-content').evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, -120);
  await expect(stage.locator('img')).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await page.locator('.dialog-content').evaluate(el => el.scrollTop)).toBe(scroll);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].coverCrop);
  expect(saved.zoom).toBeGreaterThan(1);
  expect(saved.y).toBeGreaterThan(25);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expectCoverWindowMatchesBanner(page);
  await stage.focus();
  await stage.press('ArrowUp');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].coverCrop)).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expectCoverWindowMatchesBanner(page);
  await stage.focus();
  await stage.press('+');
  await page.getByRole('button', { name: '恢复默认封面' }).click();
  await expectCoverWindowMatchesBanner(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cover-stage')).toHaveAttribute('data-reduced-motion', 'true');
  await expectCoverWindowMatchesBanner(page);
});

test('cover shows the masked banner window, offers scoped choices and resets without altering album content', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('region', { name: '写真内容', exact: true })).toHaveCount(0);
  await expect(page.locator('.media-picker')).toHaveCount(0);
  const originalDetails = await page.evaluate(() => {
    const album = JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0];
    return { subtitle: album.subtitle, description: album.description, mediaIds: album.mediaIds };
  });
  await expect(page.getByLabel('编号', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '其他信息', exact: false })).toHaveCount(0);
  await expect(page.getByLabel('副标题', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('简介', { exact: true })).toHaveCount(0);
  await page.getByLabel('编号', { exact: true }).fill('009');
  const right = await page.locator('.album-form-right').boundingBox();
  const cover = await page.locator('.album-cover-panel').boundingBox();
  expect(right!.width / (right!.width + cover!.width)).toBeCloseTo(.59, 2);
  expect(cover!.x).toBeLessThan(right!.x);
  await expect(page.getByAltText('当前写真封面', { exact: true })).toHaveCSS('object-fit', 'contain');
  await expect(page.getByAltText('当前写真封面', { exact: true })).toHaveAttribute('src', /\/tests\/fixtures\/media\//);
  await expect(page.locator('.cover-crop-window')).toBeVisible();
  const window = await page.locator('.cover-crop-window').boundingBox();
  const banner = await page.locator('.album-hero-cover-panel').boundingBox();
  expect(window!.width / window!.height).toBeCloseTo(banner!.width / banner!.height, 2);
  await expect(page.locator('.cover-crop-window')).toHaveCSS('box-shadow', /rgba\(96, 96, 96, 0.58\)/);
  const original = await page.getByAltText('当前写真封面', { exact: true }).getAttribute('src');
  const picker = page.getByLabel('封面区', { exact: true });
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await expect(picker).toBeVisible();
  await expect(picker.locator('.cover-thumbnail')).toHaveCount(3);
  await picker.getByRole('button', { name: '封面 素材 2', exact: true }).click();
  await expect(picker.getByRole('button', { name: '封面 素材 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByAltText('当前写真封面', { exact: true })).not.toHaveAttribute('src', original!);
  await page.getByRole('button', { name: '恢复默认封面' }).click();
  await expect(page.getByAltText('当前写真封面', { exact: true })).toHaveAttribute('src', original!);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const savedMedia = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].mediaIds);
  expect(savedMedia).toEqual(originalDetails.mediaIds);
  const savedDetails = await page.evaluate(() => {
    const album = JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0];
    return { subtitle: album.subtitle, description: album.description, number: album.number };
  });
  expect(savedDetails).toEqual({ subtitle: originalDetails.subtitle, description: originalDetails.description, number: '009' });
});

test('keyboard operates inline cover crop in the album editor', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const stage = page.getByRole('group', { name: '封面取景区域', exact: true });
  await stage.focus();
  await stage.press('+');
  await expect(stage.locator('img')).toHaveCSS('transform', 'matrix(1.1, 0, 0, 1.1, 0, 0)');
  await stage.press('ArrowUp');
  await expect(stage.locator('img')).toHaveCSS('object-position', '50% 23%');
  await page.keyboard.press('Tab');
  expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('button', { name: '选择封面', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue('光落在肩上');
});

test('multi-model and tag selection saves without imported media and survives reload', async ({ page }) => {
  await page.goto('/#/library?create=1');
  await page.getByLabel('写真集名称', { exact: true }).fill('新的完整写真名称');
  await page.getByRole('button', { name: '关联模特 林夏', exact: true }).click();
  await page.getByRole('button', { name: '关联模特 许知遥', exact: true }).click();
  await page.getByRole('button', { name: '选择标签', exact: true }).click();
  await page.locator('.album-tag-options').getByRole('button', { name: '清新', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择封面', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('新的完整写真名称');
  await page.reload();
  const album = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums.find((a: { name: string }) => a.name === '新的完整写真名称'));
  expect(album.modelIds).toEqual(['m0', 'm1']);
  expect(album.tags).toEqual(['t00']);
  expect(album.mediaIds).toEqual([]);
  expect(album.cover).toBe('');
});

test('nested model editor returns to the album draft and associates the new model', async ({ page }) => {
  await page.goto('/#/library?create=1');
  await page.getByLabel('写真集名称', { exact: true }).fill('保留的写真草稿');
  await page.getByRole('button', { name: '添加新模特', exact: true }).click();
  await page.getByLabel('模特名称', { exact: true }).fill('新模特档案');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue('保留的写真草稿');
  await expect(page.getByRole('button', { name: '关联模特 新模特档案', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('保留的写真草稿');
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  const model = data.models.find((m: { name: string }) => m.name === '新模特档案');
  expect(data.albums.find((a: { name: string }) => a.name === '保留的写真草稿').modelIds).toContain(model.id);
});

test('album tags expand as grouped vertical rows and keep selections when collapsed', async ({ page }) => {
  await page.goto('/#/library?create=1');
  const toggle = page.getByRole('button', { name: '选择标签', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const list = page.locator('.album-tag-options');
  await expect(list.locator('.chip')).toHaveCount(0);
  const tagCount = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).tags.length);
  await expect(list.getByRole('checkbox')).toHaveCount(0);
  await expect(list.getByRole('button')).toHaveCount(tagCount);
  const fresh = list.getByRole('button', { name: '清新', exact: true });
  const retro = list.getByRole('button', { name: '复古', exact: true });
  const first = await fresh.boundingBox();
  const second = await retro.boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  expect(second!.x).toBe(first!.x);
  await fresh.focus();
  await fresh.press('Space');
  await expect(fresh).toHaveAttribute('aria-pressed', 'true');
  await retro.click();
  await toggle.click();
  await expect(list).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '移除标签 清新', exact: true })).toBeVisible();
  await toggle.click();
  await expect(fresh).toHaveAttribute('aria-pressed', 'true');
  await expect(retro).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '移除标签 清新', exact: true }).click();
  await expect(fresh).toHaveAttribute('aria-pressed', 'false');
  await expect(retro).toHaveAttribute('aria-pressed', 'true');
});

test('tag list animates open and closed, restores focus, and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/#/library?create=1');
  const toggle = page.getByRole('button', { name: '选择标签', exact: true });
  await expect(toggle).toBeVisible();
  const sampleToggle = () => page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('.album-tag-field [aria-expanded]')!;
    trigger.click();
    const frames: { height: number; opacity: number; inert: boolean }[] = [];
    for (let i = 0; i < 24; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const region = document.querySelector<HTMLElement>('.album-tag-disclosure');
      if (region) frames.push({ height: region.getBoundingClientRect().height, opacity: Number(getComputedStyle(region).opacity), inert: region.inert });
    }
    return frames;
  });
  const opened = await sampleToggle();
  expect(opened.some(frame => frame.opacity > 0 && frame.opacity < .99)).toBe(true);
  expect(new Set(opened.map(frame => Math.round(frame.height))).size).toBeGreaterThan(2);
  await page.locator('.album-tag-options').getByRole('button', { name: '清新', exact: true }).focus();
  const closed = await sampleToggle();
  expect(closed.some(frame => frame.opacity > 0 && frame.opacity < .99)).toBe(true);
  expect(closed.every(frame => frame.inert)).toBe(true);
  expect(new Set(closed.map(frame => Math.round(frame.height))).size).toBeGreaterThan(2);
  await expect(page.locator('.album-tag-disclosure')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const reduced = await sampleToggle();
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced.every(frame => frame.opacity === 1)).toBe(true);
  expect(new Set(reduced.map(frame => Math.round(frame.height))).size).toBe(1);
  await toggle.click();
  await expect(page.locator('.album-tag-disclosure')).toHaveCount(0);
});

test('desktop minimum window and narrow layout have no horizontal overflow', async ({ page }) => {
  for (const [width, height] of [[1024, 720], [600, 850]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/library?create=1');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    expect(await page.locator('.dialog-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('failed save retains the draft for retry', async ({ page }) => {
  await page.goto('/#/library?create=1');
  await page.getByLabel('写真集名称', { exact: true }).fill('保存失败后保留的草稿');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jingji.mock.v1') throw new DOMException('Test quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法保存');
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue('保存失败后保留的草稿');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
});
