import {Locator, Page, expect} from '@playwright/test';

/** Returns the element's bounding box, failing the test if the element is not rendered. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Checks the visible action's equal insets while the row's main control is hovered. */
export async function expectEvenRowActionSpacing(row: Locator) {
  const buttons = row.getByRole('button');
  await buttons.first().hover();
  const [container, content, action] = await Promise.all([
    boxOf(row),
    boxOf(buttons.first()),
    boxOf(buttons.last()),
  ]);
  expect(action.x - (content.x + content.width)).toBe(16);
  expect(container.x + container.width - (action.x + action.width)).toBe(16);
}

/** Waits until the page no longer scrolls horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
