import { expect } from '@playwright/test';

// Compare visible source coordinates, including object-fit, position and zoom.
// This checks the actual DOM geometry rather than repeating the window formula.
export async function expectCoverWindowMatchesBanner(page) {
  await expect(page.locator('.cover-crop-window')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const source = document.querySelector('.cover-crop-stage img');
    const banner = document.querySelector('.album-hero-cover-panel img');
    return !!source?.naturalWidth && !!banner?.naturalWidth;
  })).toBe(true);
  const measure = () => page.evaluate(() => {
    const image = document.querySelector('.cover-crop-stage img');
    const source = image.getBoundingClientRect();
    const window = document.querySelector('.cover-crop-window').getBoundingClientRect();
    const bannerImage = document.querySelector('.album-hero-cover-panel img');
    const frame = document.querySelector('.album-hero-cover-panel').getBoundingClientRect();
    const style = getComputedStyle(bannerImage);
    const position = style.objectPosition.split(' ').map(value => parseFloat(value) / 100);
    const zoom = new DOMMatrixReadOnly(style.transform).a;
    const scale = Math.max(frame.width / bannerImage.naturalWidth, frame.height / bannerImage.naturalHeight) * zoom;
    const width = bannerImage.naturalWidth * scale;
    const height = bannerImage.naturalHeight * scale;
    const editor = [(window.x - source.x) / source.width, (window.y - source.y) / source.height,
      window.width / source.width, window.height / source.height];
    const actual = [(width - frame.width) * position[0] / width, (height - frame.height) * position[1] / height,
      frame.width / width, frame.height / height];
    return { error: Math.max(...editor.map((value, index) => Math.abs(value - actual[index]))),
      ratioError: Math.abs(window.width / window.height - frame.width / frame.height) };
  });
  await expect.poll(async () => (await measure()).error).toBeLessThan(.001);
  await expect.poll(async () => (await measure()).ratioError).toBeLessThan(.005);
}
