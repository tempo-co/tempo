// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import {format} from 'date-fns';

import {buildHeatTable} from '../../src/features/dashboard/utils/heat-table';
import {formatWholeMoney} from '../../src/features/dashboard/utils/money';
import {buildOverview} from '../../src/features/dashboard/utils/overview';
import {BONUS_SOURCE, EMPLOYER, HOME_TODAY, homeHistory} from '../data/home-history.data';

const eur = (euros: number) => formatWholeMoney(euros, 'EUR');

/** The model for the synthetic history: December 2024 through 5 November 2026. */
function model(
  history = homeHistory(),
  kind: 'category' | 'source' = 'category',
  missingBaseAmounts = false,
) {
  const {months, currency} = buildOverview({
    today: HOME_TODAY,
    trend: history.trend,
    flow: history.flow,
  });
  const periods = history.breakdown.year[kind];
  return buildHeatTable({periods, months, currency, kind, missingBaseAmounts});
}

test('the heat table model has each row by year, a month on average, with small rows folded', () => {
  const table = model()!;
  // Newest first; a part year says so.
  expect(table.years.map((year) => [year.year, year.note])).toEqual([
    ['2026', 'so far'],
    ['2025', ''],
    ['2024', 'from Dec'],
  ]);
  expect(table.latest).toBe(table.years[0]);
  expect(table.previous).toBe(table.years[1]);
  // Largest first; transport, entertainment and health are each under 3% of all spending.
  expect(table.top.map((row) => row.name)).toEqual([
    'Housing and utilities',
    'Food and drink',
    'Shopping',
    'Travel',
  ]);
  expect(table.folded.map((row) => row.name)).toEqual([
    'Transportation',
    'Entertainment',
    'Health',
  ]);
  expect(table.more?.name).toBe('3 more categories');

  // 2026 has ten whole months and 5 of November's 30 days: €13,200 of housing is €1,298 a month.
  const [housing] = table.top;
  expect(housing.category).toBe('HOUSING_AND_UTILITIES');
  expect(housing.change).toBe('+8%');
  expect(housing.cells.map((cell) => [cell.value, cell.body])).toEqual([
    [1_320_000, eur(1298)],
    [1_440_000, eur(1200)],
    [120_000, eur(1200)],
  ]);
  // Shaded against the row's highest year; December 2024 alone is too thin to shade.
  const [newest, before, first] = housing.cells.map((cell) => cell.alpha);
  expect(newest).toBeCloseTo(0.45);
  expect(before).toBeCloseTo(0.05 + (1200 / 1298.36) * 0.4);
  expect(first).toBe(0);
  expect(housing.cells[0].tip).toEqual({
    label: `Housing and utilities, 2026: ${eur(1298)} a month · ${eur(13200)} in the year so far`,
    note: '2026 so far',
    month: eur(1298),
    year: eur(13200),
    soFar: true,
    versus: {label: 'vs 2025', value: '+8%'},
    folded: [],
  });
  // The first year has none before it.
  expect(housing.cells[2].tip.versus).toBeUndefined();
  // Each cell opens its year's rows of the category, from the first month of history in the first year.
  const drill = housing.cells[2].search!;
  expect(drill.categories).toEqual(['HOUSING_AND_UTILITIES']);
  expect(drill.cashFlows).toEqual(['SPENDING']);
  expect(format(drill.bookingDate!.from!, 'yyyy-MM-dd')).toBe('2024-12-01');
  expect(format(drill.bookingDate!.to!, 'yyyy-MM-dd')).toBe('2024-12-31');

  // A year without the category shows a dash and opens nothing.
  const travel = table.top[3];
  expect(travel.change).toBe('new');
  expect(travel.cells.map((cell) => [cell.body, cell.search === undefined])).toEqual([
    [eur(148), false],
    ['–', true],
    ['–', true],
  ]);

  // The folded row sums its rows, opens none and is not shaded; its tip names the largest that year.
  const more = table.more!;
  expect(more.change).toBe('−2%');
  expect(more.cells.map((cell) => cell.body)).toEqual([eur(98), eur(100), eur(100)]);
  expect(more.cells.every((cell) => cell.alpha === 0 && cell.search === undefined)).toBe(true);
  expect(more.cells[1].tip).toMatchObject({
    year: eur(1200),
    versus: undefined,
    folded: [
      {key: 'TRANSPORTATION', name: 'Transportation', month: `${eur(60)} a month`},
      {key: 'ENTERTAINMENT', name: 'Entertainment', month: `${eur(30)} a month`},
      {key: 'HEALTH', name: 'Health', month: `${eur(10)} a month`},
    ],
  });

  expect(table.total.change).toBe('+12%');
  expect(table.total.cells.map((cell) => cell.body)).toEqual([eur(2233), eur(2000), eur(2000)]);
  expect(table.total.cells[0].tip.label).toBe(
    `Total, 2026: ${eur(2233)} a month · ${eur(22700)} in the year so far`,
  );
});

test('the heat table model names each income source and opens its rows by source key', () => {
  const table = model(homeHistory(), 'source', true)!;
  expect(table.top.map((row) => [row.key, row.name, row.source?.key])).toEqual([
    [EMPLOYER, 'Example Employer', EMPLOYER],
    [BONUS_SOURCE, 'Example Bonus', BONUS_SOURCE],
  ]);
  expect(table.more).toBeUndefined();
  const [employer, bonus] = table.top;
  expect(employer.cells.map((cell) => cell.body)).toEqual([eur(2951), eur(3000), eur(3000)]);
  expect(bonus.change).toBe('−100%');
  // While some rows wait for a base-currency amount, a cell opens only rows that have one, as its total counts.
  expect(employer.cells[1].search).toMatchObject({
    cashFlows: ['INCOME'],
    incomeSource: EMPLOYER,
    baseAmount: 'PRESENT',
  });
});

test('the heat table model has no table when nothing came in', () => {
  expect(model(homeHistory({income: () => ({})}), 'source')).toBeNull();
});
