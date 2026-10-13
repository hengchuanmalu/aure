import { expect,test } from '@playwright/test';
import { seedFixture } from "../support/demo.fixture";

test('mixed album grid, browse entry and reloaded viewer all put videos last', async ({ page }) => {
  const db = seedFixture();
  db.albums[0].mediaIds = ['v1', 'p2', 'v0', 'p0', 'p1'];
  await page.addInitScript(snapshot => {
    if (!localStorage.getItem('jingji.mock.v1')) localStorage.setItem('jingji.mock.v1', snapshot);
    localStorage.setItem('aure.media-view.v1', JSON.stringify({ mode: 'adaptive', columns: 5 }));
  }, JSON.stringify(db));
  await page.goto('/#/album/a0');
  const cards = page.locator('.media-card');
  await expect(cards).toHaveCount(5);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-media-id')))).toEqual(['p2', 'p0', 'p1', 'v1', 'v0']);
  await expect.poll(() => cards.evaluateAll(nodes => {
    const lastPhoto = nodes[2].getBoundingClientRect();
    const firstVideo = nodes[3].getBoundingClientRect();
    return Math.abs(lastPhoto.top - firstVideo.top) < 1 && firstVideo.left > lastPhoto.right;
  })).toBe(true);
  await page.getByRole('button', { name: '浏览写真', exact: true }).click();
  await expect(page).toHaveURL(/\/viewer\/a0\/p2$/);
  for (const id of ['p0', 'p1', 'v1', 'v0']) {
    await page.mouse.move(600, 300);
    await page.getByRole('button', { name: '下一项', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viewer/a0/${id}$`));
  }
  await page.goto('/#/viewer/a0/p1');
  await page.reload();
  await expect(page.locator('.viewer')).toBeVisible();
  // The stage retains a thumbnail while the original decodes; assert the original.
  const original = page.locator('.media-stage > img');
  await expect(original).toHaveAttribute('src', db.media.find(item => item.id === 'p1')!.src);
  await expect.poll(() => original.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/viewer\/a0\/v1$/);
  await expect(page.locator('.media-stage video')).toHaveCount(1);
  await page.getByRole('button', { name: '上一项', exact: true }).click();
  await expect(page).toHaveURL(/\/viewer\/a0\/p1$/);
});
