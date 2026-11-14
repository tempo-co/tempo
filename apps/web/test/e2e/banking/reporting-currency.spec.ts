import type {Page} from '@playwright/test';
import {REPORTING_CURRENCIES, type ReportingCurrency} from '@tempo/contracts';

import {
  HOME_CONNECTION,
  HOME_NOW,
  homeHistory,
  homeRanking,
  homeRecurring,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';
import {openRemoval, routeMockedBankApp} from '../../utils/bank-connections';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const QUESTION = 'Which currency should Tempo use for totals?';

/** Accounts in EUR and GBP, no currency chosen yet, and recent transactions mostly in GBP. */
const ASKING: ReportingCurrency = {
  currency: null,
  confirmed: false,
  setupRequired: true,
  suggestion: 'GBP',
  connectedCurrencies: ['EUR', 'GBP'],
  options: ['EUR', 'GBP', ...REPORTING_CURRENCIES.filter((code) => !['EUR', 'GBP'].includes(code))],
  recalculating: false,
};

/** Answers the reporting currency from `state`, which a save changes as the API would. */
async function mockReportingCurrency(
  page: Page,
  initial: ReportingCurrency,
  {recalculates = true}: {recalculates?: boolean} = {},
) {
  const api = {state: initial, saved: [] as string[], reads: 0};
  await page.route('**/reporting-currency', async (route) => {
    if (route.request().method() === 'PUT') {
      const {currency} = route.request().postDataJSON() as {currency: string};
      api.saved.push(currency);
      api.state = {
        ...api.state,
        currency,
        confirmed: true,
        setupRequired: false,
        suggestion: null,
        recalculating: recalculates && currency !== api.state.currency,
      };
    } else {
      api.reads += 1;
    }
    return fulfillJson(route, api.state);
  });
  return api;
}

test.describe('fully mocked', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('asks on Connections which currency totals use, keeps the pick through a refetch and saves it', async ({
    page,
    baseURL,
  }) => {
    // The bank's first sync is still running and finishes while the owner chooses.
    test.setTimeout(30_000);
    await routeMockedBankApp(page, baseURL);
    let syncing = true;
    await mockBankConnections(page, () => [
      syncing
        ? {...HOME_CONNECTION, syncStatus: 'RUNNING'}
        : {...HOME_CONNECTION, lastSyncedAt: '2026-11-05T12:00:00.000Z'},
    ]);
    const api = await mockReportingCurrency(page, ASKING);
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/bank-connections');

    const setup = page.getByRole('region', {name: QUESTION});
    await expect(setup).toContainText('Your accounts are in EUR and GBP.');
    // Under the title, above the banks.
    const title = await boxOf(page.getByRole('heading', {name: 'Bank connections', level: 1}));
    const bank = await boxOf(page.getByTestId(`bank-connection-${HOME_CONNECTION.id}`));
    const box = await boxOf(setup);
    expect(box.y).toBeGreaterThan(title.y + title.height);
    expect(box.y + box.height).toBeLessThan(bank.y);

    const picker = setup.getByTestId('reporting-currency-picker');
    await expect(picker).toHaveText('GBP — British Pound');
    await expect(setup.getByText('Suggested from your recent transactions.')).toBeVisible();
    const save = setup.getByTestId('reporting-currency-save');
    await expect(save).toHaveText('Use GBP');

    await picker.click();
    const dialog = page.getByRole('dialog', {name: 'Currency for totals'});
    await expect(
      dialog.getByRole('region', {name: 'Your accounts'}).getByRole('button'),
    ).toHaveText(['EUR — Euro', 'GBP — British Pound']);
    await dialog.getByTestId('currency-search').fill('yen');
    await expect(dialog.getByRole('button', {name: 'JPY — Japanese Yen'})).toBeVisible();
    await dialog.getByTestId('currency-search').fill('');
    await dialog.getByRole('button', {name: 'EUR — Euro'}).click();
    await expect(dialog).toBeHidden();
    await expect(picker).toHaveText('EUR — Euro');
    await expect(save).toHaveText('Use EUR');
    await expect(setup.getByText('Suggested from your recent transactions.')).toBeHidden();

    // The sync finishes and the next answer suggests something else; the owner's pick stays.
    api.state = {...api.state, suggestion: 'USD'};
    const reads = api.reads;
    syncing = false;
    await expect.poll(() => api.reads, {timeout: 10_000}).toBeGreaterThan(reads);
    await expect(picker).toHaveText('EUR — Euro');

    await save.click();
    await expect(setup).toBeHidden();
    expect(api.saved).toEqual(['EUR']);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('Home and a linked month ask before they add anything up, then wait while totals are recalculated', async ({
    page,
    homePage,
  }) => {
    await page.clock.setFixedTime(HOME_NOW);
    await mockSyntheticHome(page);
    // The two currencies tie, so nothing is suggested.
    const api = await mockReportingCurrency(page, {...ASKING, suggestion: null});
    // The history answers in no currency until one is chosen and its amounts are converted.
    const history = homeHistory();
    let currency: string | null = null;
    await page.route('**/bank-transactions/balance-trend?**', (route) =>
      new URL(route.request().url()).searchParams.get('interval') === 'month'
        ? fulfillJson(route, {...history.trend, baseCurrency: currency})
        : route.fallback(),
    );
    await page.route('**/bank-transactions/cash-flow?**', (route) =>
      fulfillJson(route, {...history.flow, baseCurrency: currency}),
    );
    await page.goto('/?month=2026-10');

    const setup = page.getByRole('region', {name: QUESTION});
    const month = homePage.monthDialog('October 2026');
    await expect(setup.getByText('Choose a currency before saving.')).toBeVisible();
    await expect(homePage.whereYouStand).toBeHidden();
    await expect(month).toBeHidden();
    await setup.getByRole('button', {name: 'Save'}).click();
    await page.getByRole('dialog').getByRole('button', {name: 'GBP — British Pound'}).click();
    await setup.getByRole('button', {name: 'Use GBP'}).click();

    await expect(page.getByRole('heading', {name: 'Recalculating totals in GBP'})).toBeVisible();
    expect(api.saved).toEqual(['GBP']);
    await expect(homePage.whereYouStand).toBeHidden();
    await expect(month).toBeHidden();

    // Once the amounts are converted, the figures and the month come back in GBP without a reload.
    currency = 'GBP';
    api.state = {...api.state, recalculating: false};
    await expect(month).toBeVisible({timeout: 10_000});
    await expect(page.getByRole('heading', {name: 'Recalculating totals in GBP'})).toBeHidden();
    await expect(month.getByRole('region', {name: 'The month'})).toContainText('£');
    await page.keyboard.press('Escape');
    await expect(homePage.totalBalance).toContainText('£');
  });

  test('Home and a linked month show no figures before the reporting currency is known', async ({
    page,
    homePage,
  }) => {
    await page.clock.setFixedTime(HOME_NOW);
    await mockSyntheticHome(page);
    await mockReportingCurrency(page, {...ASKING, suggestion: null});
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = false;
    await page.route('**/reporting-currency', async (route) => {
      asked = true;
      await held;
      return route.fallback();
    });
    await page.goto('/?month=2026-10');

    const month = homePage.monthDialog('October 2026');
    // Whether the history may be added up is still unknown: nothing of it shows.
    await expect.poll(() => asked).toBe(true);
    await page.waitForTimeout(300);
    await expect(homePage.whereYouStand).toHaveCount(0);
    await expect(month).toHaveCount(0);
    release();
    await expect(page.getByRole('region', {name: QUESTION})).toBeVisible();
    await expect(homePage.whereYouStand).toBeHidden();
    await expect(month).toBeHidden();
  });

  test('Home drops figures in the old currency as soon as another is chosen', async ({
    page,
    homePage,
  }) => {
    await page.clock.setFixedTime(HOME_NOW);
    await mockSyntheticHome(page);
    // EUR was used automatically; a GBP account has since appeared, so Home asks while showing its figures.
    // Every amount is in GBP already, so a change has nothing to recalculate.
    const api = await mockReportingCurrency(
      page,
      {...ASKING, currency: 'EUR', suggestion: null},
      {recalculates: false},
    );
    await page.goto('/');
    await expect(homePage.totalBalance).toContainText('€');

    // The new figures take a while; meanwhile none of the EUR ones may be shown under GBP.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/bank-transactions/balance-trend?**', async (route) => {
      await held;
      return route.fallback();
    });
    const setup = page.getByRole('region', {name: QUESTION});
    await setup.getByTestId('reporting-currency-picker').click();
    await page.getByRole('dialog').getByRole('button', {name: 'GBP — British Pound'}).click();
    await setup.getByRole('button', {name: 'Use GBP'}).click();
    await expect.poll(() => api.saved).toEqual(['GBP']);
    try {
      await expect(homePage.totalBalance).not.toContainText('€');
    } finally {
      release();
    }
  });

  test('stops asking once the bank in the other currency is removed', async ({page, baseURL}) => {
    await routeMockedBankApp(page, baseURL);
    const gbpBank = {
      ...HOME_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000c2',
      aspspName: 'Example Second Bank',
      bankAccounts: [
        {
          ...HOME_CONNECTION.bankAccounts[0],
          id: '00000000-0000-4000-8000-0000000000a2',
          currency: 'GBP',
        },
      ],
    };
    let connections = [HOME_CONNECTION, gbpBank];
    await mockBankConnections(page, () => connections);
    const api = await mockReportingCurrency(page, ASKING);
    await page.route(`**/bank-connections/${gbpBank.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      // With one currency left, the API uses it and stops asking.
      connections = [HOME_CONNECTION];
      api.state = {
        ...api.state,
        currency: 'EUR',
        setupRequired: false,
        suggestion: null,
        connectedCurrencies: ['EUR'],
      };
      return route.fulfill({status: 204, body: ''});
    });
    await page.goto('/bank-connections');
    const setup = page.getByRole('region', {name: QUESTION});
    await expect(setup).toBeVisible();

    await openRemoval(page, page.getByTestId(`bank-connection-${gbpBank.id}`));
    await page.getByTestId(`remove-bank-confirmation-${gbpBank.id}`).fill('DELETE');
    await page.getByRole('button', {name: 'Remove permanently', exact: true}).click();

    await expect(page.getByTestId(`bank-connection-${gbpBank.id}`)).toHaveCount(0);
    // Once the removal dialog has closed, the page is readable again and asks nothing.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(QUESTION)).toHaveCount(0);
  });

  test('Home drops figures in the old currency when it was changed elsewhere', async ({
    page,
    homePage,
    baseURL,
  }) => {
    await page.clock.setFixedTime(HOME_NOW);
    // Fails on any request the mocks miss, instead of letting it take the app offline.
    await routeMockedBankApp(page, baseURL);
    await mockSyntheticHome(page);
    const api = await mockReportingCurrency(page, {
      ...ASKING,
      currency: 'EUR',
      confirmed: true,
      setupRequired: false,
      suggestion: null,
      connectedCurrencies: ['EUR'],
    });
    // Home's history answers in whichever currency the totals are in now.
    const history = homeHistory();
    let currency = 'EUR';
    let held: Promise<void> = Promise.resolve();
    await page.route('**/bank-transactions/balance-trend?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('interval') !== 'month')
        return route.fallback();
      await held;
      return fulfillJson(route, {...history.trend, baseCurrency: currency});
    });
    await page.route('**/bank-transactions/cash-flow?**', (route) =>
      fulfillJson(route, {...history.flow, baseCurrency: currency}),
    );
    await page.goto('/');
    await expect(homePage.totalBalance).toContainText('€');

    // Another tab or device changes the currency to USD, and its amounts are converted. Connections reads it.
    api.state = {...api.state, currency: 'USD'};
    currency = 'USD';
    let release!: () => void;
    held = new Promise<void>((resolve) => (release = resolve));
    const reads = api.reads;
    await page
      .getByRole('navigation', {name: 'Primary'})
      .getByRole('link', {name: 'Connections', exact: true})
      .click();
    await expect(page.getByRole('heading', {name: 'Bank connections', level: 1})).toBeVisible();
    await expect.poll(() => api.reads).toBeGreaterThan(reads);
    await page.goBack();

    // Until the USD balances arrive, the balance and flows show neither the EUR ones nor a mix under one name.
    await expect(homePage.whereYouStand).toBeVisible();
    await page.waitForTimeout(300);
    const balanceAndFlows = (await homePage.whereYouStand.innerText()).split('Repeats')[0];
    expect(balanceAndFlows).not.toContain('€');
    release();
    await expect(homePage.totalBalance).toContainText('$');

    // Breakdowns still answering in EUR are not shown under the history's USD, on Home or in a month.
    const spending = page.getByRole('region', {name: 'Spending by category'});
    await expect(spending).toHaveAttribute('aria-busy', 'true');
    expect(await spending.innerText()).not.toContain('$');
    await page.goto('/?month=2026-10');
    const month = homePage.monthDialog('October 2026');
    await expect(month.getByRole('region', {name: 'The month'})).toContainText('$');
    const went = month.getByRole('region', {name: 'Where it went'});
    await expect(went).toBeVisible();
    expect(await went.innerText()).not.toContain('$');
  });

  test('Home stops adding up figures when a change elsewhere is still being converted', async ({
    page,
    homePage,
    baseURL,
  }) => {
    await page.clock.install({time: HOME_NOW});
    await routeMockedBankApp(page, baseURL);
    await mockSyntheticHome(page);
    const api = await mockReportingCurrency(page, {
      ...ASKING,
      currency: 'EUR',
      confirmed: true,
      setupRequired: false,
      suggestion: null,
      connectedCurrencies: ['EUR'],
    });
    const history = homeHistory();
    let currency: string | null = 'EUR';
    await page.route('**/bank-transactions/balance-trend?**', (route) =>
      new URL(route.request().url()).searchParams.get('interval') === 'month'
        ? fulfillJson(route, {...history.trend, baseCurrency: currency})
        : route.fallback(),
    );
    await page.route('**/bank-transactions/cash-flow?**', (route) =>
      fulfillJson(route, {...history.flow, baseCurrency: currency}),
    );
    await page.goto('/');
    await expect(homePage.totalBalance).toContainText('€');

    // Another device switched to USD; until its amounts are converted, figures come back in no currency.
    api.state = {...api.state, currency: 'USD', recalculating: true};
    currency = null;
    await page.clock.runFor(5 * 60_000 + 1_000);

    // Home reads the settings again instead of showing the partial figures as plain numbers.
    await expect(page.getByRole('heading', {name: 'Recalculating totals in USD'})).toBeVisible();
    await expect(homePage.whereYouStand).toBeHidden();
  });

  test('dialogs wait for figures read while a change elsewhere is converted instead of showing plain numbers', async ({
    page,
    baseURL,
  }) => {
    await routeMockedBankApp(page, baseURL);
    await mockSyntheticHome(page);
    await mockReportingCurrency(page, {
      ...ASKING,
      currency: 'EUR',
      confirmed: true,
      setupRequired: false,
      suggestion: null,
      connectedCurrencies: ['EUR'],
    });
    // Each opening reads the settings once; the refetch its first partial answer prompts stays slow.
    let reads = 0;
    await page.route('**/reporting-currency', async (route) => {
      reads += 1;
      if (reads === 1) return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      return route.fallback().catch(() => undefined);
    });
    // Another device switched currency; rankings and recurring lists come back in no currency until converted.
    const recurring = homeRecurring();
    await page.route('**/recurring-series?**', (route) =>
      fulfillJson(route, {
        expenses: {...recurring.lists.expenses, baseCurrency: null},
        income: {...recurring.lists.income, baseCurrency: null},
      }),
    );
    await page.route('**/merchants/ranking?**', (route) =>
      fulfillJson(route, {
        ...homeRanking(new URL(route.request().url()).searchParams.get('period') ?? ''),
        baseCurrency: null,
      }),
    );
    await page.route('**/merchants?**', (route) =>
      fulfillJson(route, {baseCurrency: null, merchants: [], total: 0}),
    );

    const open = async (url: string, path: string) => {
      reads = 0;
      const answered = page.waitForResponse((response) => response.url().includes(path));
      await page.goto(url);
      await answered;
    };

    await open('/?merchants=open', '/merchants/ranking?');
    const top = page.getByRole('region', {name: 'Top merchants'});
    await expect(top.getByRole('img', {name: 'Loading top merchants'})).toBeVisible();
    await expect(top.getByRole('listitem')).toHaveCount(0);

    await open('/?recurring=open', '/recurring-series?');
    await expect(page.getByLabel('Loading recurring payments')).toBeVisible();
    await expect(page.getByTestId('recurring-summary')).toBeHidden();

    await open('/?month=2026-10', '/merchants/ranking?');
    const biggest = page.getByRole('region', {name: 'Biggest merchants'});
    await expect(biggest.getByText('Loading merchants')).toBeVisible();
    await expect(biggest.getByRole('listitem')).toHaveCount(0);
  });

  for (const width of [390, 320]) {
    test(`the question fits a ${width}px phone with many account currencies`, async ({
      page,
      baseURL,
    }) => {
      await page.clock.setFixedTime(HOME_NOW);
      await page.setViewportSize({width, height: 844});
      await routeMockedBankApp(page, baseURL);
      await mockBankConnections(page, [HOME_CONNECTION]);
      const connected = ['CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HUF', 'NOK', 'PLN', 'RON', 'SEK'];
      await mockReportingCurrency(page, {
        ...ASKING,
        connectedCurrencies: connected,
        options: [
          ...connected,
          ...REPORTING_CURRENCIES.filter((code) => !connected.includes(code)),
        ],
        suggestion: 'CZK',
      });
      await page.goto('/bank-connections');

      const setup = page.getByRole('region', {name: QUESTION});
      await expect(setup.getByTestId('reporting-currency-picker')).toHaveText('CZK — Czech Koruna');
      await expectNoHorizontalOverflow(page);
      for (const button of await setup.getByRole('button').all()) {
        expect((await boxOf(button)).height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('against the API', () => {
  test('saves a reporting currency from Settings, keeps it after reload and on another device', async ({
    page,
    browser,
    freshAccount,
    accountSettingsPage,
  }) => {
    await accountSettingsPage.navigate();
    const value = page.getByTestId('account-reporting-currency');
    await expect(value).toHaveText('Not chosen yet');

    const edit = page.getByRole('button', {name: 'Edit reporting currency'});
    await edit.click();
    const dialog = page.getByRole('dialog', {name: 'Reporting currency'});
    const save = dialog.getByTestId('save-reporting-currency-button');
    await expect(save).toBeDisabled();
    await expect(dialog.getByText('Choose a currency before saving.')).toBeVisible();
    await dialog.getByTestId('currency-search').fill('pound');
    await dialog.getByRole('button', {name: 'GBP — British Pound'}).click();
    await expect(dialog.getByText('Totals are recalculated in the new currency')).toBeVisible();
    // Cancelling saves nothing.
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(value).toHaveText('Not chosen yet');

    await edit.click();
    await dialog.getByTestId('currency-search').fill('pound');
    await dialog.getByRole('button', {name: 'GBP — British Pound'}).click();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(value).toHaveText('GBP — British Pound');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await page.reload();
    await expect(value).toHaveText('GBP — British Pound');

    const other = await browser.newContext({storageState: {cookies: [], origins: []}});
    try {
      const otherPage = await other.newPage();
      await new LoginPage(otherPage).login(freshAccount.email, freshAccount.password);
      await new HomePage(otherPage).expectToBeOnPage();
      await otherPage.goto('/settings/account');
      await expect(otherPage.getByTestId('account-reporting-currency')).toHaveText(
        'GBP — British Pound',
      );
    } finally {
      await other.close();
    }
  });
});
