// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import {BANK_TRANSACTION_CATEGORIES} from '@tempo/contracts';

import {BANK_TRANSACTION_CATEGORY_META} from '../../src/features/banking/utils/bank-transaction-category-meta';
import {resolve} from '../utils/theme-css';

/** To check is a state, not a category: it stays muted, so it has no colour of its own. */
const CATEGORIES = BANK_TRANSACTION_CATEGORIES.filter((category) => category !== 'NEEDS_REVIEW');

/** The colour a category reads in one theme, through the `var()` its entry names. */
function colourOf(category: (typeof CATEGORIES)[number], theme: 'light' | 'dark') {
  const reference = BANK_TRANSACTION_CATEGORY_META[category].color.match(/^var\((--[\w-]+)\)$/);
  if (!reference) throw new Error(`${category} names no colour variable`);
  return resolve(reference[1], theme);
}

for (const theme of ['light', 'dark'] as const) {
  test(`every category has its own colour in the ${theme} theme`, () => {
    const byColour = new Map<string, string[]>();
    for (const category of CATEGORIES) {
      const colour = colourOf(category, theme);
      byColour.set(colour, [...(byColour.get(colour) ?? []), category]);
    }
    const shared = [...byColour.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.join(' and '));

    expect(shared).toEqual([]);
  });
}

test('every category has a dark value of its own', () => {
  const same = CATEGORIES.filter(
    (category) => colourOf(category, 'light') === colourOf(category, 'dark'),
  );

  expect(same).toEqual([]);
});

test('every category has its own icon and label', () => {
  const icons = new Set(
    CATEGORIES.map((category) => BANK_TRANSACTION_CATEGORY_META[category].icon),
  );
  const labels = CATEGORIES.map((category) => BANK_TRANSACTION_CATEGORY_META[category].label);

  expect(icons.size).toBe(CATEGORIES.length);
  expect(labels.every((label) => label.length > 0)).toBe(true);
});
