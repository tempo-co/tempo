import {Locator, Page, expect} from '@playwright/test';

/** Returns the element's bounding box, failing the test if the element is not rendered. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Waits until no part of `scope` is still loading (`aria-busy`), so checks see the loaded layout, not placeholders. */
export async function expectLoaded(scope: Page | Locator) {
  if (!('goto' in scope)) {
    await expect(scope).toBeVisible();
    await expect(scope).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(scope.locator('[aria-busy="true"]')).toHaveCount(0);
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

/**
 * Checks that the income source `name` in `scope` has its tile where a category's icon would be: 20px, centred
 * on the name and 8px before it, showing the logo image or, without one, the fallback icon.
 */
export async function expectSourceTile(scope: Locator, name: string, shows: 'logo' | 'icon') {
  const label = scope.getByText(name, {exact: true});
  const tileTest = '@data-testid="merchant-logo-tile"';
  const tile = label.locator(
    `xpath=ancestor-or-self::*[preceding-sibling::*[${tileTest}]][1]/preceding-sibling::*[${tileTest}][1]`,
  );
  if (shows === 'logo') {
    await expect(tile.locator('img')).toBeVisible();
    await expect
      .poll(() => tile.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1);
  } else {
    await expect(tile.locator('img')).toHaveCount(0);
    await expect(tile.locator('svg')).toBeVisible();
  }
  const [tileBox, labelBox] = await Promise.all([boxOf(tile), boxOf(label)]);
  expect(tileBox).toMatchObject({width: 20, height: 20});
  expect(
    Math.abs(tileBox.y + tileBox.height / 2 - (labelBox.y + labelBox.height / 2)),
  ).toBeLessThanOrEqual(1);
  expect(labelBox.x - (tileBox.x + tileBox.width)).toBe(8);
}

/** Waits until the page no longer scrolls horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
