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

/** Checks the 20px decorative icon beside a category's name: centred on it, 8px before it. */
export async function expectCategoryIcon(scope: Locator, name: string) {
  const label = scope.getByText(name, {exact: true});
  const icon = label.locator('xpath=preceding-sibling::*[@aria-hidden="true"][1]');
  await expect(icon.locator('svg')).toBeVisible();
  const [iconBox, labelBox] = await Promise.all([boxOf(icon), boxOf(label)]);
  expect(iconBox).toMatchObject({width: 20, height: 20});
  expect(
    Math.abs(iconBox.y + iconBox.height / 2 - (labelBox.y + labelBox.height / 2)),
  ).toBeLessThanOrEqual(1);
  expect(labelBox.x - (iconBox.x + iconBox.width)).toBe(8);
}

/** Waits until the page no longer scrolls horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
