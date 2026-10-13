import { test as base,expect } from '@playwright/test';
import { seedFixture } from "./demo.fixture";
export type { Page } from '@playwright/test';
export { expect };

// Example data is opt-in test setup and is never bundled with the application.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(snapshot => {
      if (!localStorage.getItem('jingji.mock.v1')) localStorage.setItem('jingji.mock.v1', snapshot);
    }, JSON.stringify(seedFixture()));
    await use(page);
  },
});
