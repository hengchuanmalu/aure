import { expect,test } from "../support/browser.fixture";

test('album actions follow the cover, header and lower-right positions and keep their behavior', async ({ page }) => {
  await page.goto('/#/album/a0?type=image');
  const edit = page.locator('.topbar').getByRole('button', { name: '编辑写真集', exact: true });
  await expect(edit).toBeVisible();
  await expect(page.getByRole('button', { name: '添加写真', exact: true })).toHaveCount(0);
  await expect(page.locator('.album-hero-actions button')).toHaveCount(0);
  await expect(page.locator('.album-browse-layer button')).toHaveCount(1);
  const remove = await page.locator('.album-backline .album-remove').boundingBox();
  expect(remove!.y + remove!.height).toBeLessThan((await page.locator('.album-hero').boundingBox())!.y);
  await expect(page.locator('.album-hero')).toHaveAttribute('data-cover-layout', 'landscape');
  const favorite = page.locator('.album-cover-favorite');
  const cover = await page.locator('.album-hero-cover').boundingBox();
  const heart = await favorite.boundingBox();
  expect(heart!.x).toBeGreaterThan(cover!.x + cover!.width / 2);
  expect(heart!.y - cover!.y).toBeCloseTo(16, 0);
  expect(cover!.x + cover!.width - heart!.x - heart!.width).toBeCloseTo(16, 0);
  const browse = page.getByRole('button', { name: '浏览写真', exact: true });
  const offsets = await page.locator('.album-hero').evaluate(element => {
    const hero = element.getBoundingClientRect();
    const copy = element.querySelector('.album-hero-copy')!.getBoundingClientRect();
    const actions = element.querySelector('.album-hero-actions')!.getBoundingClientRect();
    const cover = element.querySelector('.album-hero-cover')!.getBoundingClientRect();
    return { right: hero.right - actions.right, bottom: hero.bottom - actions.bottom, copyLeft: copy.left - hero.left, copyBottom: hero.bottom - copy.bottom, coverWidth: cover.width - hero.width, coverHeight: cover.height - hero.height, separate: actions.left >= copy.right };
  });
  expect(offsets.right).toBeCloseTo(16, 0);
  expect(offsets.bottom).toBeCloseTo(24, 0);
  expect(offsets.copyLeft).toBeCloseTo(32, 0);
  expect(offsets.copyBottom).toBeCloseTo(24, 0);
  expect(Math.abs(offsets.coverWidth)).toBeLessThan(1);
  expect(Math.abs(offsets.coverHeight)).toBeLessThan(1);
  expect(offsets.separate).toBe(true);
  await page.locator('.album-cover-trigger').click({ position: { x: 120, y: 60 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await favorite.hover();
  await expect(favorite).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.2)');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await edit.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('写真集名称', { exact: true })).toHaveValue('光落在肩上');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/type=image$/);
  await browse.click();
  await expect(page).toHaveURL(/\/viewer\/a0\/p0$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.album-hero')).toBeVisible();
  await page.getByRole('button', { name: '移出演示库', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('不删除磁盘素材');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  for (const width of [1920, 1440, 1024, 800, 540]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.album-cover-favorite')).toBeVisible();
    await expect(browse).toBeVisible();
    const overlap = await page.locator('.album-hero').evaluate(element => {
      const copy = element.querySelector('.album-hero-copy')!.getBoundingClientRect();
      const actions = element.querySelector('.album-hero-actions')!.getBoundingClientRect();
      return copy.right > actions.left && copy.bottom > actions.top;
    });
    expect(overlap).toBe(false);
    await page.screenshot({ path: `verification/album-detail-actions/browser-${width}.png` });
  }
});

test('landscape cover accommodates long names, multiple models and an empty album', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    snapshot.albums[0].name = '这是用于检查横版封面长标题换行的写真集名称，窗口缩小时资料和操作仍然各自可见';
    snapshot.albums[0].modelIds = snapshot.models.map((model: { id: string }) => model.id);
    snapshot.albums[0].number = '051';
    snapshot.albums[0].coverCrop = { x: 40, y: 25, zoom: 1.2 };
    snapshot.albums[0].mediaIds = [];
    localStorage.setItem('jingji.mock.v1', JSON.stringify(snapshot));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '浏览写真', exact: true })).toBeDisabled();
  await expect(page.locator('.album-hero-meta')).toContainText('编号 051');
  await expect(page.locator('.album-people a')).toHaveCount(6);
  await expect(page.locator('.album-hero-cover img')).toHaveCSS('object-position', '40% 25%');
  for (const width of [1440, 1024, 540]) {
    await page.setViewportSize({ width, height: 960 });
    const geometry = await page.locator('.album-hero').evaluate(element => {
      const hero = element.getBoundingClientRect();
      const copy = element.querySelector('.album-hero-copy')!.getBoundingClientRect();
      const actions = element.querySelector('.album-hero-actions')!.getBoundingClientRect();
      return { contained: copy.bottom <= hero.bottom && actions.bottom <= hero.bottom, separate: copy.right <= actions.left || copy.bottom <= actions.top, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry).toEqual({ contained: true, separate: true, overflow: false });
  }
});

test('browse magnet catches only near contact, aligns content, and keeps its node and focus', async ({ page }) => {
  await page.goto('/#/album/a0');
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    const media = Array.from({ length: 80 }, (_, i) => ({ ...db.media[0], id: `magnet-${i}` }));
    db.media.push(...media); db.albums[0].mediaIds = media.map(item => item.id);
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.reload();
  const browse = page.locator('.album-browse');
  await expect(browse).toHaveAttribute('data-docked', 'false');
  const near = (gap: number) => page.evaluate(gap => {
    const origin = document.querySelector('.album-browse-origin')!.getBoundingClientRect();
    const edit = document.querySelector('.topbar-action-group > button')!.getBoundingClientRect();
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    scrollTo(0, origin.top + scrollY - (edit.bottom - header.top + gap));
  }, gap);
  const handoff = () => page.evaluate(() => {
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const cover = document.querySelector('.album-hero')!.getBoundingClientRect();
    const content = document.querySelector('.album-content-toolbar')!.getBoundingClientRect();
    return { cover: cover.bottom - header.bottom, content: content.top - header.bottom };
  });
  expect(await browse.evaluate(el => Math.abs(el.getBoundingClientRect().left - document.querySelector('.topbar-action-group > button')!.getBoundingClientRect().left))).toBeLessThan(1);
  await near(20);
  await page.waitForTimeout(100);
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await page.evaluate(() => {
    (window as any).__magnetFrames = [];
    (window as any).__recordMagnet = true;
    const sample = () => {
      (window as any).__magnetFrames.push(scrollY);
      if ((window as any).__recordMagnet) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await near(6);
  await expect(browse).toHaveAttribute('data-docked', 'true');
  await expect.poll(async () => Math.abs((await handoff()).content)).toBeLessThan(1);
  expect((await handoff()).cover).toBeLessThanOrEqual(0);
  const frames = await page.evaluate(() => { (window as any).__recordMagnet = false; return (window as any).__magnetFrames as number[]; });
  expect(new Set(frames.map(Math.round)).size).toBeGreaterThan(2);
  await page.screenshot({ path: 'verification/album-magnet/browser-contact-handoff.png' });
  // Reverse input cancels the short settling animation instead of pulling the user back down.
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -360 }));
    scrollTo(0, 0);
  });
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await near(20);
  await near(6);
  await expect(browse).toHaveAttribute('data-docked', 'true');
  const interruptedAt = await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -360 }));
    return scrollY;
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY)).toBe(interruptedAt);
  await page.mouse.move(700, 350);
  await page.mouse.wheel(0, -360);
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await page.waitForTimeout(300);
  expect((await handoff()).content).toBeGreaterThan(40);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await browse.evaluate(el => { (window as any).__browseNode = el; (el as HTMLElement).focus({ preventScroll: true }); });
  await page.evaluate(() => scrollTo(0, 650));
  await expect(browse).toHaveAttribute('data-docked', 'true');
  const geometry = () => browse.evaluate(el => {
    const button = el.getBoundingClientRect();
    const edit = document.querySelector('.topbar-action-group > button')!.getBoundingClientRect();
    return { gap: Math.abs(edit.left - button.left), centers: Math.abs(button.top + button.height / 2 - edit.top - edit.height / 2), same: el === (window as any).__browseNode, focused: document.activeElement === el, fits: button.left >= 0 && button.right <= innerWidth };
  });
  await expect.poll(async () => (await geometry()).gap).toBeLessThan(1);
  await expect.poll(async () => (await geometry()).centers).toBeLessThan(1);
  expect(await geometry()).toMatchObject({ same: true, focused: true, fits: true });
  await expect(page.getByRole('button', { name: '编辑写真集', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(650);
  await page.screenshot({ path: 'verification/album-magnet/browser-docked.png' });
  await browse.click();
  await expect(page.locator('.viewer')).toBeVisible();
  expect(await browse.evaluate(el => !!el.closest('[inert]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(browse).toHaveAttribute('data-docked', 'true');
  for (const width of [1024, 800, 540, 400]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(async () => (await geometry()).gap).toBeLessThan(1);
    expect((await geometry()).fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.evaluate(() => scrollTo(0, 0));
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await expect.poll(() => browse.evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.album-browse-origin')!.getBoundingClientRect().top))).toBeLessThan(1);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await near(20);
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await near(6);
  await expect(browse).toHaveAttribute('data-docked', 'true');
  await expect.poll(async () => Math.abs((await handoff()).content)).toBeLessThan(1);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.topbar-action-group > button').evaluate(el => (el as HTMLElement).focus({ preventScroll: true }));
  await page.evaluate(() => scrollTo(0, 650));
  await expect(browse).toHaveAttribute('data-docked', 'true');
  await expect(browse).toBeFocused();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(browse).toHaveAttribute('data-docked', 'false');
  await page.getByRole('button', { name: '编辑写真集', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/#/library');
  await expect(browse).toHaveCount(0);
  await expect(page.locator('.topbar-action-group')).toHaveAttribute('data-browse-docked', 'false');
});
