import { expect } from '@playwright/test';

export async function checkSidebarSelection(page) {
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.locator('a.active .sidebar-selection')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  const source = nav.getByRole('link', { name: '发现', exact: true });
  await source.click();
  await page.waitForTimeout(250);
  const target = nav.getByRole('link', { name: '写真库', exact: true });
  await target.hover();
  await page.waitForTimeout(200);
  const colors = await page.evaluate(() => {
    const active = document.querySelector('.sidebar-selection');
    const hover = document.querySelector('.sidebar-nav a[data-nav-path="/library"]');
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const activeColor = rgb(getComputedStyle(active).backgroundColor);
    const hoverColor = rgb(getComputedStyle(hover, '::before').backgroundColor);
    return { activeColor, hoverColor, hoverOpacity: getComputedStyle(hover, '::before').opacity };
  });
  // color(srgb ...) is serialized in 0..1; rgb(...) in 0..255.
  const activeGray = colors.activeColor[0] <= 1 ? colors.activeColor[0] * 255 : colors.activeColor[0];
  expect(activeGray).toBeLessThan(colors.hoverColor[0] - 10);
  expect(colors.hoverOpacity).toBe('1');
  const frames = await page.evaluate(async () => {
    const source = document.querySelector('.sidebar-nav a.active');
    const target = document.querySelector('.sidebar-nav a[data-nav-path="/library"]');
    const start = source.getBoundingClientRect().top;
    const end = target.getBoundingClientRect().top;
    const samples = [];
    target.click();
    const until = performance.now() + 350;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      const indicator = target.querySelector('.sidebar-selection');
      if (indicator) samples.push(indicator.getBoundingClientRect().top);
    }
    return { start, end, samples };
  });
  expect(frames.samples.some(y => y > frames.start + 1 && y < frames.end - 1)).toBe(true);
  expect(frames.samples.at(-1)).toBeCloseTo(frames.end, 0);
  // The fixed sidebar must stay in viewport coordinates while Shell restores
  // different document scroll positions. Cover both directions, not just y=0.
  const scrollTransitions = [];
  await source.click();
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(100);
  await target.click();
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 650));
  await page.waitForTimeout(100);
  for (const path of ['/', '/library']) {
    const probe = await page.evaluate(async path => {
      const source = document.querySelector('.sidebar-nav a.active');
      const target = [...document.querySelectorAll('.sidebar-nav a')].find(link => link.dataset.navPath === path);
      const from = source.getBoundingClientRect().top;
      const to = target.getBoundingClientRect().top;
      const beforeScroll = scrollY;
      const samples = [];
      target.click();
      const until = performance.now() + 400;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        const indicator = target.querySelector('.sidebar-selection');
        if (indicator) samples.push(indicator.getBoundingClientRect().top);
      }
      return { path, from, to, beforeScroll, afterScroll: scrollY, samples };
    }, path);
    expect(Math.abs(probe.beforeScroll - probe.afterScroll)).toBeGreaterThan(50);
    expect(probe.samples.length).toBeGreaterThan(2);
    for (const top of probe.samples) {
      expect(top).toBeGreaterThanOrEqual(Math.min(probe.from, probe.to) - 1);
      expect(top).toBeLessThanOrEqual(Math.max(probe.from, probe.to) + 1);
    }
    expect(probe.samples.at(-1)).toBeCloseTo(probe.to, 0);
    scrollTransitions.push({ path, scrollDelta: probe.afterScroll - probe.beforeScroll, minTop: Math.min(...probe.samples), maxTop: Math.max(...probe.samples) });
  }
  await page.evaluate(() => {
    document.querySelector('.sidebar-nav a[data-nav-path="/tags"]').click();
    setTimeout(() => document.querySelector('.sidebar-nav a[data-nav-path="/models"]').click(), 40);
  });
  await expect(nav.getByRole('link', { name: '模特', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.waitForTimeout(300);
  await expect(nav.locator('.sidebar-selection')).toHaveCount(1);
  expect(await nav.locator('a.active').evaluate(link => Math.abs(link.getBoundingClientRect().top - link.querySelector('.sidebar-selection').getBoundingClientRect().top))).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const settings = nav.getByRole('link', { name: '设置', exact: true });
  await settings.click();
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(settings.locator('.sidebar-selection')).toBeVisible();
  const reducedOffset = await settings.evaluate(target =>
    Math.abs(target.getBoundingClientRect().top - target.querySelector('.sidebar-selection').getBoundingClientRect().top));
  expect(reducedOffset).toBeLessThan(1);
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { activeGray, hoverGray: colors.hoverColor[0], intermediateFrames: frames.samples.filter(y => y > frames.start + 1 && y < frames.end - 1).length, scrollTransitions, interruption: true, reducedMotion: true, keyboard: true };
}
