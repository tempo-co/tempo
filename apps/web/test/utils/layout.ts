import {Locator, Page, expect} from '@playwright/test';

/** Returns the element's bounding box, failing the test if the element is not rendered. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Waits until the page no longer scrolls horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
