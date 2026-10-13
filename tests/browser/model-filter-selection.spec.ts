import { expect, test } from '../support/browser.fixture';

test('sticky model selection stays within its row when document scroll changes during a switch', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('.filter-indicator')).toBeVisible();
  for (const index of [1, 0, 2, 0]) {
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(100);
    const result = await page.evaluate(async index => {
      const root = document.querySelector<HTMLElement>('.model-filters')!;
      const target = root.querySelectorAll('button')[index];
      const samples: number[] = [];
      target.click();
      // Desktop URL-backed filters restore document scroll in the same commit.
      window.scrollTo(0, 0);
      const until = performance.now() + 350;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        const indicator = root.querySelector<HTMLElement>('.filter-indicator')!;
        samples.push(indicator.getBoundingClientRect().y - root.getBoundingClientRect().y);
      }
      const indicator = root.querySelector<HTMLElement>('.filter-indicator')!;
      return { samples, expectedY: target.offsetTop,
        x: indicator.getBoundingClientRect().x - root.getBoundingClientRect().x + root.scrollLeft,
        expectedX: target.offsetLeft };
    }, index);
    for (const y of result.samples) expect(y).toBeCloseTo(result.expectedY, 0);
    expect(result.x).toBeCloseTo(result.expectedX, 0);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.model-filters button').nth(1).click();
  await expect(page.locator('.model-filters button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.filter-indicator')).toHaveCount(1);
});
