import {Locator, Page} from '@playwright/test';

/**
 * How many elements match once the toasts already raised have rendered. Sonner renders a toast in a
 * timeout after it is raised, and a retrying `toHaveCount` would wait an extra toast out, so this
 * waits one timeout and reads once.
 */
export async function countAfterToasts(page: Page, locator: Locator) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return locator.count();
}
