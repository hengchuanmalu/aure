import { test } from '../support/browser.fixture';
import { checkSidebarSelection } from '../support/sidebar-selection.mjs';

test('sidebar selection moves between pages, differs from hover, and respects reduced motion', async ({ page }) => {
  await page.goto('/#/');
  await checkSidebarSelection(page);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发现', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '写真库', exact: true }).hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'verification/sidebar-selection-browser.png' });
});
