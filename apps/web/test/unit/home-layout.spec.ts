// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {
  DEFAULT_HOME_LAYOUT,
  moveCard,
  phoneRuns,
  readHomeLayout,
} from '../../src/features/home/utils/home-layout';

test('a saved layout reads back whole: unknown and repeated cards drop out, cards it never named take their default place', () => {
  expect(
    readHomeLayout(
      JSON.stringify({
        order: ['accounts', 'pace', 'retired-card', 'accounts', 'coming'],
        hidden: ['recent', 'retired-card'],
      }),
    ),
  ).toEqual({
    order: ['accounts', 'pace', 'coming', 'categories', 'recent', 'data', 'todo'],
    hidden: ['recent'],
  });
  for (const unreadable of [null, '', 'not json', '42', 'null'])
    expect(readHomeLayout(unreadable)).toEqual(DEFAULT_HOME_LAYOUT);
});

test('on a phone, Your data and To do lead, then the main cards, then the rest of the rail; a card moves only within its run', () => {
  const layout = {...DEFAULT_HOME_LAYOUT, hidden: ['categories' as const]};
  const runs = phoneRuns(layout);
  expect(runs).toEqual([['data', 'todo'], ['pace', 'accounts', 'recent'], ['coming']]);

  // Down past the hidden card: Accounts moves above the pace, the hidden one keeps its place.
  expect(moveCard(layout, runs[1], 'pace', 1).order).toEqual([
    'accounts',
    'categories',
    'pace',
    'recent',
    'data',
    'todo',
    'coming',
  ]);
  // The ends of a run stay put.
  expect(moveCard(layout, runs[0], 'data', -1)).toBe(layout);
  expect(moveCard(layout, runs[2], 'coming', 1)).toBe(layout);
});
