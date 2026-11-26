// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {buildMoneyFlow} from '../../src/features/insights/utils/money-flow';

const part = (key: string, amount: string, label = key) => ({key, label, amount, count: 1});
const nodes = (side: {label: string; cents: number}[]) =>
  side.map(({label, cents}) => [label, cents]);

test('the money flow runs from income sources to categories and what was kept, small ones merged into Other', () => {
  const flow = buildMoneyFlow({
    income: 1_000_000,
    spending: 700_000,
    sources: [
      part('INCOME:example employer', '9600.00', 'Example Employer'),
      part('INCOME:example shop', '300.00', 'Example Shop'),
      part('INCOME:example market', '100.00', 'Example Market'),
    ],
    categories: [
      part('HOUSING_AND_UTILITIES', '4000.00'),
      part('GROCERIES', '2000.00'),
      part('SHOPPING', '300.00'),
      part('HEALTH', '400.00'),
      // A category holding only refunds takes nothing from income.
      part('ENTERTAINMENT', '-50.00'),
    ],
  })!;
  // Sources under 5% of income share one node; €1,000 of €10,000 is the 5% line and stays.
  expect(nodes(flow.sources)).toEqual([
    ['Example Employer', 960_000],
    ['Other income', 40_000],
  ]);
  expect(nodes(flow.targets)).toEqual([
    ['Housing and utilities', 400_000],
    ['Groceries', 200_000],
    ['Other (2 categories)', 70_000],
    ['Kept', 300_000],
  ]);
  expect(flow.targets.map((node) => node.share)).toEqual([0.4, 0.2, 0.07, 0.3]);
  expect(flow.total).toBe(1_000_000);
});

test('spending more than came in draws the difference from savings', () => {
  const flow = buildMoneyFlow({
    income: 200_000,
    spending: 250_000,
    sources: [part('INCOME:example employer', '2000.00', 'Example Employer')],
    categories: [part('HOUSING_AND_UTILITIES', '2410.00'), part('HEALTH', '90.00')],
  })!;
  expect(nodes(flow.sources)).toEqual([
    ['Example Employer', 200_000],
    ['From savings', 50_000],
  ]);
  // A lone small category keeps its own name rather than an Other of one.
  expect(nodes(flow.targets)).toEqual([
    ['Housing and utilities', 241_000],
    ['Health and fitness', 9_000],
  ]);
  expect(flow.total).toBe(250_000);
});

test('a period with nothing in or out has no flow', () => {
  expect(buildMoneyFlow({income: 0, spending: 0, sources: [], categories: []})).toBeNull();
});
