import type {BankConnection, BankImportSummary} from '@wisp/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {bankImport, importedFiles} from '../../data/bank-import.data';
import {createBankTransaction} from '../../data/bank-transaction.data';
import {expect, test} from '../../fixtures';
import {balanceTrend, mockAccountsApi} from '../../utils/accounts';
import {mockBankRefresh} from '../../utils/api-mocks';
import {routeMockedBankApp} from '../../utils/bank-connections';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const DAY = 24 * 60 * 60 * 1000;
const account = MOCK_CONNECTION.bankAccounts[0];
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const dateAgo = (days: number) => ago(days).slice(0, 10);

/** The kind data the page was designed with: two synced accounts and one file account, all current. */
function demo() {
  const fileAccount = {
    ...account,
    id: '00000000-0000-4000-8000-0000000000f1',
    details: 'Travel wallet',
    balanceSource: 'file' as const,
  };
  return {
    connections: [
      {...MOCK_CONNECTION, lastSuccessfulSyncAt: ago(0.1)},
      importedFiles([fileAccount]),
    ],
    imports: [bankImport(fileAccount.id, {dateTo: dateAgo(3)})],
    open: account.id,
  };
}

/**
 * Realistic worst cases spread over the rows: long and one-letter names and banks, every connection problem, a bank with no account, a
 * stale file and one never imported, no balance, huge and foreign amounts, an IBAN-length number, non-Latin text.
 */
function worstCase() {
  const longAlias = 'Gezamenlijke huishoudrekening voor vaste lasten, boodschappen en vakanties';
  const connections: BankConnection[] = [
    {
      ...MOCK_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000a1',
      aspspName: 'Coöperatieve Voorbeeldbank Noord-Holland Zuid en Omstreken Particulieren',
      consentValidUntil: new Date(Date.now() + 3 * DAY).toISOString(),
      lastSuccessfulSyncAt: ago(0.04),
      bankAccounts: [
        {
          ...account,
          id: '00000000-0000-4000-8000-0000000000b1',
          alias: longAlias,
          currentBalanceAmount: '-1234567890.12',
        },
        {
          ...account,
          id: '00000000-0000-4000-8000-0000000000b2',
          details: 'Spaarrekening',
          cashAccountType: 'SVGS',
          currency: 'CHF',
          currentBalanceAmount: '98765432.10',
          currentBalanceInBaseCurrency: '105432109.87',
          maskedIdentifier: 'NL91ABNA0417164300',
        },
        {
          ...account,
          id: '00000000-0000-4000-8000-0000000000b3',
          details: null,
          name: 'NL91ABNA0417164300NL91ABNA0417164300GB82WEST12345698765432',
          cashAccountType: 'CARD',
          maskedIdentifier: null,
          currentBalanceAmount: '0',
        },
      ],
    },
    {
      ...MOCK_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000a2',
      aspspName: 'Jo',
      syncStatus: 'RATE_LIMITED',
      lastSyncedAt: '2025-01-01T12:00:00.000Z',
      lastSuccessfulSyncAt: '2025-01-01T12:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      nextSyncAt: '2025-01-02T00:00:00.000Z',
      bankAccounts: [{...account, id: '00000000-0000-4000-8000-0000000000b5', alias: 'J'}],
    },
    {
      ...MOCK_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000a4',
      aspspName: 'Example Bank 🏦',
      status: 'EXPIRED',
      lastSuccessfulSyncAt: ago(40),
      bankAccounts: [
        {
          ...account,
          id: '00000000-0000-4000-8000-0000000000b6',
          cashAccountType: 'CARD',
          details: 'Кредитная карта',
          currency: 'JPY',
          currentBalanceAmount: '123456789012',
          currentBalanceInBaseCurrency: null,
        },
      ],
    },
    {
      ...MOCK_CONNECTION,
      id: '00000000-0000-4000-8000-0000000000a3',
      aspspName: 'Банк Пример Северо-Западного федерального округа',
      bankAccounts: [],
    },
    importedFiles([
      {
        ...account,
        id: '00000000-0000-4000-8000-0000000000f2',
        alias: 'Rekening courant Aleksandra Wiśniewska-Kowalczyk en Bartholomew Fitzgerald',
        maskedIdentifier: 'GB82WEST12345698765432',
        currentBalanceAmount: null,
        balanceSource: null,
        latestBalances: [],
      },
      {
        ...account,
        id: '00000000-0000-4000-8000-0000000000f3',
        details: 'Oude spaarrekening',
        cashAccountType: 'SVGS',
        currentBalanceAmount: '1.00',
        balanceSource: 'stated',
      },
    ]),
  ];
  const imports: BankImportSummary[] = [
    bankImport('00000000-0000-4000-8000-0000000000f2', {
      dateTo: dateAgo(400),
      createdAt: ago(390),
      filesCount: 20,
      rowsAdded: 12_345,
      rowsDoubtful: 1_284,
    }),
  ];
  return {connections, imports, open: '00000000-0000-4000-8000-0000000000b1'};
}

test.describe('accounts layout', () => {
  test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 1440, theme: 'dark'},
    {width: 390, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'light'},
    {width: 320, theme: 'dark'},
  ]) {
    test(`Accounts and an account page keep rows, figures and actions whole at ${width}px in ${theme}, with demo and worst-case data`, async ({
      page,
      baseURL,
    }, testInfo) => {
      test.setTimeout(30_000);
      await page.setViewportSize({width, height: 900});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await routeMockedBankApp(page, baseURL);
      await mockBankRefresh(page);
      let data = demo();
      await mockAccountsApi(page, () => ({
        ...data,
        transactions: [
          createBankTransaction({
            id: '00000000-0000-4000-8000-000000000e01',
            counterpartyName: 'Openbaar Vervoer Reisproducten Nederland Noord-Holland en Utrecht',
            amount: '-1234567.89',
            bookingDate: dateAgo(1),
          }),
          createBankTransaction({
            id: '00000000-0000-4000-8000-000000000e02',
            bookingDate: dateAgo(200),
          }),
        ],
        trend: balanceTrend(
          data.connections
            .flatMap((connection) => connection.bankAccounts)
            .map(({id}, index) => ({id, start: -1_000_000 * index, step: 250_000})),
        ),
      }));

      for (const name of ['demo', 'worst case'] as const) {
        data = name === 'demo' ? demo() : worstCase();
        await page.goto('/accounts');
        const rows = page.getByTestId(/^account-row-/);
        const accounts = data.connections.flatMap((connection) => connection.bankAccounts);
        await expect(rows).toHaveCount(accounts.length);
        await expect(page.getByTestId('account-freshness').first()).toBeVisible();

        for (const row of await rows.all()) {
          const [rowBox, tileBox, linkBox] = await Promise.all([
            boxOf(row),
            boxOf(row.getByTestId('account-bank-logo')),
            boxOf(row.getByRole('link')),
          ]);
          expect(rowBox.height, name).toBeGreaterThanOrEqual(60);
          expect(tileBox, name).toMatchObject({width: 36, height: 36});
          expect(rowBox.x + rowBox.width, name).toBeLessThanOrEqual(width);
          // The name truncates; it never pushes the amount out.
          expect(linkBox.x + linkBox.width, name).toBeLessThanOrEqual(rowBox.x + rowBox.width);
          // Amounts are never cut short: each fits its own box.
          for (const amount of await row.locator('.numeric').all())
            expect(await amount.evaluate((el) => el.scrollWidth <= el.clientWidth), name).toBe(
              true,
            );
          for (const button of await row.getByRole('button').all()) {
            const box = await boxOf(button);
            expect(box.x + box.width, name).toBeLessThanOrEqual(rowBox.x + rowBox.width);
            if (width < 640) expect(box.height, name).toBeGreaterThanOrEqual(44);
          }
        }
        const total = page.getByTestId('accounts-total');
        if (name === 'demo') {
          await expect(total).toContainText('€');
          const figure = total.locator('.numeric').first();
          expect(await figure.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
        if (name === 'worst case') {
          // Mixed currencies without every conversion have no total; the bank that shared no account stands apart.
          await expect(total).toHaveCount(0);
          await expect(page.getByTestId('accounts-unlinked')).toContainText('No accounts shared');
          await expect(page.getByRole('button', {name: 'Reconnect'})).toHaveCount(4);
          await expect(page.getByRole('button', {name: 'Import newer'})).toHaveCount(1);
          await expect(page.getByRole('button', {name: /^Add balance of /})).toHaveCount(1);
        }
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: testInfo.outputPath(`accounts-${name}-${width}-${theme}.png`),
          fullPage: width > 640,
        });

        await page.goto(`/accounts/${data.open}`);
        const heading = page.getByRole('heading', {level: 1});
        await expect(heading).toBeVisible();
        const balance = page.getByTestId('account-balance');
        await expect(balance.locator('.recharts-surface')).toBeVisible();
        for (const figure of await balance.locator('.numeric').all())
          expect(await figure.evaluate((el) => el.scrollWidth <= el.clientWidth), name).toBe(true);
        for (const card of [
          balance,
          page.getByTestId('account-about'),
          page.getByTestId('account-connection'),
        ]) {
          const box = await boxOf(card);
          expect(box.x + box.width, name).toBeLessThanOrEqual(width);
        }
        expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth), name).toBe(true);
        // Desktop puts About and the connection beside the balance; phones stack them under it.
        const [balanceBox, aboutBox] = await Promise.all([
          boxOf(balance),
          boxOf(page.getByTestId('account-about')),
        ]);
        expect(aboutBox.x > balanceBox.x, name).toBe(width >= 1024);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: testInfo.outputPath(`account-${name}-${width}-${theme}.png`),
          fullPage: width > 640,
        });
      }
    });
  }
});
