import { expect,test } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";
import { prepareBatchImport } from '../../src/application/batch-album-import';
import { commitAlbumImport } from '../../src/application/album-import';

test('cover fits the whole source and floating choices follow the lower-half hover without resizing', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await page.getByRole('dialog').evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  const area = page.locator('.cover-stage');
  const stage = page.getByRole('group', { name: '封面取景区域', exact: true });
  const rail = page.locator('.cover-filmstrip');
  await expect(area).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(area).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rail).toHaveCSS('border-width', '0px');
  await expect(rail).toHaveCSS('box-shadow', 'none');
  await expect.poll(() => stage.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(stage.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect.poll(() => stage.evaluate(element => {
    const image = element.querySelector('img')!;
    return Math.abs(element.clientWidth / element.clientHeight - image.naturalWidth / image.naturalHeight);
  })).toBeLessThan(.01);
  const before = await stage.boundingBox();
  const box = (await area.boundingBox())!;
  await area.hover({ position: { x: 20, y: 20 } });
  await expect(rail).toHaveCSS('opacity', '0');
  await expect(rail).toHaveAttribute('inert', '');
  await area.hover({ position: { x: 20, y: box.height * .7 } });
  await expect(rail).toHaveCSS('opacity', '1');
  const railBox = (await rail.boundingBox())!;
  expect(Math.abs(box.y + box.height - railBox.y - railBox.height)).toBeLessThanOrEqual(2);
  expect(await stage.boundingBox()).toEqual(before);
  await expect(rail.getByRole('button', { name: /滚动封面照片/ })).toHaveCount(0);
  await expect(rail.locator('[title]')).toHaveCount(0);
  await expect(stage).not.toHaveAttribute('title');
  const choice = page.getByRole('button', { name: '封面 素材 2', exact: true });
  const choiceBefore = (await choice.boundingBox())!;
  await choice.hover();
  await expect(choice).toHaveCSS('scale', '1.08');
  const choiceAfter = (await choice.boundingBox())!;
  expect(Math.abs(choiceAfter.x + choiceAfter.width / 2 - choiceBefore.x - choiceBefore.width / 2)).toBeLessThan(1);
  expect(Math.abs(choiceAfter.y + choiceAfter.height - choiceBefore.y - choiceBefore.height)).toBeLessThan(1);
  await expect(choice.locator('.photo-frame')).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.333) 0px 4px 10px 0px');
  await page.screenshot({ path: 'verification/cover-editor/browser-hover.png' });
  await page.getByRole('button', { name: '封面 素材 2', exact: true }).click();
  await expect(page.getByAltText('当前写真封面')).toHaveAttribute('src', /p-774909/);
  await page.getByLabel('写真集名称', { exact: true }).hover();
  await expect(rail).toHaveCSS('opacity', '0');
  await expect(rail).toHaveAttribute('inert', '');
  await page.getByRole('group', { name: '显示封面缩略图', exact: true }).press('Enter');
  await expect(rail).toHaveCSS('opacity', '1');
  await page.getByLabel('写真集名称', { exact: true }).focus();
  await expect(rail).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await area.hover({ position: { x: 20, y: box.height * .7 } });
  await expect(rail).toHaveCSS('transition-duration', '0s');
  await choice.hover();
  await expect(choice).toHaveCSS('scale', '1');
  await expect(choice).toHaveCSS('transition-duration', '0s');
  await page.screenshot({ path: 'verification/cover-editor/browser-floating.png' });
});

test('cover stays on the left and only model candidates scroll vertically', async ({ page }) => {
  const db = seedFixture();
  db.models = Array.from({ length: 40 }, (_, i) => ({ ...db.models[0], id: `scroll-model-${i}`, name: `滚动模特 ${i}` }));
  await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', snapshot), JSON.stringify(db));
  for (const [width, height] of [[1440, 960], [1024, 720], [600, 850]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/library?create=1');
    await page.reload();
    await expect(page.getByRole('heading', { name: '封面', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => {
      const cover = document.querySelector('.album-cover-panel')!.getBoundingClientRect();
      const info = document.querySelector('.album-form-right')!.getBoundingClientRect();
      return cover.right <= info.left + 1;
    })).toBe(true);
    await page.getByRole('button', { name: '选择标签', exact: true }).click();
    await expect(page.locator('.album-tag-options').getByRole('button', { name: '清新', exact: true })).toBeVisible();
    expect(await page.locator('.dialog-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await page.locator('.album-form-right').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const before = await page.getByLabel('写真集名称', { exact: true }).evaluate(el => (el as HTMLElement).offsetTop);
    const models = page.getByRole('group', { name: '关联模特列表', exact: true });
    expect(await models.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.getByRole('button', { name: '关联模特 滚动模特 39', exact: true }).scrollIntoViewIfNeeded();
    expect(await models.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: '关联模特 滚动模特 39', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: '关联模特 滚动模特 39', exact: true }).click();
    await expect(page.getByRole('button', { name: '关联模特 滚动模特 39', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.getByLabel('写真集名称', { exact: true }).evaluate(el => (el as HTMLElement).offsetTop)).toBe(before);
  }
});

test('automatically imported media remain editable in the inline cover panel', async ({ page }) => {
  const db = seedFixture();
  const media = db.media.filter(m => m.kind === 'image').slice(1, 3);
  const folder = { path: 'D:/fixtures/import-cover', name: '导入预览', skipped: 0,
    files: media.map((item, index) => ({ path: `D:/fixtures/import-cover/${index}.jpg`, name: `${index}.jpg`, kind: 'image' as const, size: item.size })) };
  const prepared = prepareBatchImport({ path: folder.path, name: folder.name, albums: [folder], issues: [] }, db,
    Object.fromEntries(folder.files.map((file, index) => [file.path, media[index].src])));
  // Browser-only rendering uses fixture URLs, without native thumbnail paths.
  for (const entry of prepared.entries) for (const item of entry.pending?.media || []) item.sourcePath = undefined;
  // Prepare the same imported album through application logic. The rendering
  // acceptance works with both development modules and compiled route chunks.
  const entry = prepared.entries[0];
  const imported = structuredClone(db);
  commitAlbumImport(imported, entry.pending!, entry.album!);
  await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', JSON.stringify(snapshot)), imported);
  await page.goto(`/#/album/${encodeURIComponent(entry.album!.id)}`);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await expect(picker.locator('.cover-thumbnail')).toHaveCount(2);
  await expect(picker.locator('.picker-pages')).toHaveCount(0);
  await picker.locator('.cover-thumbnail').nth(1).click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('input[type="range"]')).toHaveCount(0);
  await expect(picker.locator('.cover-crop-grid')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '选择封面', exact: true })).toHaveCount(0);
  await expect(page.getByAltText('当前写真封面')).toHaveAttribute('src', media[1].src);
});

 test('existing cover choices reach beyond 48 items by scrolling and save a stable ID', async ({ page }) => {
  const db = seedFixture();
  const original = db.media.find(m => m.kind === 'image')!;
  const media = Array.from({ length: 60 }, (_, i) => ({ ...original, id: `cover-${i}`, name: `cover-${i}.jpg` }));
  db.media.push(...media); db.albums[0].mediaIds = media.map(m => m.id);
  await page.addInitScript(snapshot => localStorage.setItem('jingji.mock.v1', snapshot), JSON.stringify(db));
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await expect.poll(() => picker.locator('.cover-thumbnail').count()).toBeGreaterThan(0);
  expect(await picker.locator('.cover-thumbnail').count()).toBeLessThan(48);
  const strip = picker.getByRole('group', { name: '封面照片', exact: true });
  await strip.press('End');
  await expect.poll(() => strip.evaluate(el => Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth))).toBeLessThan(1);
  const last = picker.getByRole('button', { name: '封面 素材 60', exact: true });
  const lastBefore = (await last.boundingBox())!;
  await last.hover();
  await expect(last).toHaveCSS('scale', '1.08');
  const lastAfter = (await last.boundingBox())!;
  expect(Math.abs(lastAfter.x + lastAfter.width / 2 - lastBefore.x - lastBefore.width / 2)).toBeLessThan(1);
  expect(Math.abs(lastAfter.y + lastAfter.height - lastBefore.y - lastBefore.height)).toBeLessThan(1);
  expect(lastAfter.width / lastBefore.width).toBeCloseTo(1.08, 2);
  await last.click();
  await page.getByRole('button', { name: '保存' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0].coverMediaId)).toBe('cover-59');
});

test('cover wheel, drag, keyboard, reset, cancel and save preserve image sources', async ({ page }) => {
  await page.goto('/#/album/a0');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  const picker = page.getByLabel('封面区', { exact: true });
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  const stage = picker.getByRole('group', { name: '封面取景区域', exact: true });
  await picker.getByRole('button', { name: '封面 素材 2', exact: true }).click();
  await expect.poll(() => stage.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await stage.hover();
  await page.mouse.wheel(0, -100);
  await expect(stage.locator('img')).toHaveCSS('transform', 'matrix(1.11, 0, 0, 1.11, 0, 0)');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 20); await page.mouse.up();
  expect(await stage.locator('img').evaluate(image => image.style.objectPosition)).not.toBe('50% 50%');
  await picker.getByRole('button', { name: '恢复默认封面' }).click();
  await expect(stage.locator('img')).toHaveCSS('object-position', '50% 25%');
  await stage.press('+'); await stage.press('ArrowUp'); await stage.press('ArrowLeft');
  await page.screenshot({ path: 'verification/cover-editor/browser.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!).albums[0])).toEqual(before.albums[0]);
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByAltText('当前写真封面')).toHaveAttribute('src', before.albums[0].cover);
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await picker.getByRole('button', { name: '封面 素材 2', exact: true }).click();
  await stage.press('+'); await stage.press('ArrowUp'); await stage.press('ArrowLeft');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  expect(after.albums[0].coverCrop).toEqual({ x: 48, y: 23, zoom: 1.1 });
  expect(after.media).toEqual(before.media);
  expect(after.albums[0].mediaIds).toEqual(before.albums[0].mediaIds);
  await page.reload();
  await expect(page.getByRole('button', { name: '查看封面大图' }).locator('img')).toHaveCSS('object-position', '48% 23%');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(stage.locator('img')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});

test('cover selection stays within a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.goto('/#/album/a0');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存' })).toBeInViewport();
  await expect(page.getByRole('group', { name: '封面取景区域' })).toBeInViewport();
  await page.locator('.cover-stage').hover({ position: { x: 40, y: (await page.locator('.cover-stage').boundingBox())!.height * .8 } });
  await expect(page.getByRole('group', { name: '封面缩略图', exact: true })).toBeInViewport();
  expect(await page.getByLabel('封面区', { exact: true }).evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
