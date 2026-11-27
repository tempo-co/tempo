import type {BankConnection} from '@wisp/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {mockAccountsApi} from '../../utils/accounts';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';
import {accountRow, openAccount, routeMockedBankApp} from '../../utils/bank-connections';
import {
  CHECKING,
  FILE_ACCOUNT_ID,
  IMPORTED_FILES,
  TODAY,
  expectCurrencyInside,
  expectInsideViewport,
  importSummary,
  mockFileImport,
  mockSetBalance,
} from '../../utils/file-import';
import {animationsSettled, boxOf, expectNoHorizontalOverflow} from '../../utils/layout';
import {countAfterToasts} from '../../utils/toasts';

test.describe('imports on Accounts', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    serviceWorkers: 'block',
    timezoneId: 'Europe/Amsterdam',
  });

  test.beforeEach(async ({page, baseURL}) => {
    await page.clock.setFixedTime(TODAY);
    await routeMockedBankApp(page, baseURL);
    // An account page's own reads; each test answers the connections and imports.
    await mockAccountsApi(page, () => ({connections: []}));
  });

  test('the Imports tab lists imports newest first, undoes one after confirming, also on a second try, and keeps it listed as undone', async ({
    page,
  }) => {
    const imports = [
      importSummary({
        id: '00000000-0000-4000-8000-000000000511',
        rowsDoubtful: 0,
        accounts: [
          {id: CHECKING.id, name: null, currency: 'EUR', created: false},
          {id: FILE_ACCOUNT_ID, name: null, currency: 'EUR', created: true},
        ],
      }),
      importSummary({
        id: '00000000-0000-4000-8000-000000000512',
        filesCount: 1,
        rowsAdded: 0,
        rowsDoubtful: 0,
        createdAt: '2026-11-11T08:00:00.000Z',
      }),
      importSummary({
        id: '00000000-0000-4000-8000-000000000513',
        createdAt: '2026-10-02T08:00:00.000Z',
        undoneAt: '2026-10-03T08:00:00.000Z',
        rowsDoubtful: 0,
      }),
      ...[4, 5, 6].map((n) =>
        importSummary({
          id: `00000000-0000-4000-8000-00000000052${n}`,
          createdAt: `2026-09-0${n}T08:00:00.000Z`,
          rowsDoubtful: 0,
        }),
      ),
    ];
    await mockBankConnections(page, [MOCK_CONNECTION, IMPORTED_FILES]);
    const api = await mockFileImport(page, {imports});
    let undoFails = true;
    await page.route(`${API_URL}/bank-imports/*`, (route) => {
      if (route.request().method() !== 'DELETE' || !undoFails) return route.fallback();
      undoFails = false;
      return fulfillJson(route, {statusCode: 500, message: 'Internal server error'}, 500);
    });
    await page.goto('/accounts');

    // The file account runs up to its newest import's last day.
    const fileFreshness = accountRow(page, FILE_ACCOUNT_ID).getByTestId('account-freshness');
    await expect(fileFreshness).toHaveText('File up to 30 Oct · imported today');
    await page.getByRole('tab', {name: 'Imports'}).click();
    await expect(page).toHaveURL(/\/accounts\?tab=imports$/);
    const list = page.getByTestId('bank-imports-list');
    await expect(list.getByTestId('bank-import-row')).toHaveCount(5);
    const rows = list.getByTestId('bank-import-row');
    await expect(rows.nth(1)).toContainText('1 file · nothing new');
    await expect(rows.nth(1)).toContainText('Yesterday');
    const undone = rows.nth(2);
    await expect(undone.getByRole('button', {name: '3 files', exact: true})).toBeVisible();
    await expect(undone).toContainText('Undone 3 Oct');
    await expect(undone.getByRole('button', {name: /^Undo/})).toHaveCount(0);
    await page.getByRole('button', {name: 'Show all'}).click();
    await expect(rows).toHaveCount(6);
    await expect(page.getByRole('button', {name: 'Show all'})).toHaveCount(0);

    await rows.first().getByRole('button', {name: 'Undo import from 12 Nov'}).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', {name: 'Undo this import?'})).toBeVisible();
    await expect(confirm).toContainText(
      'This removes the 212 transactions it added. Any that bank sync has picked up since then are kept. ' +
        'The account it created is removed too, unless another import also added transactions to it.',
    );
    await confirm.getByRole('button', {name: 'Undo import'}).click();
    // A failed try says so in the confirmation, which stays open for another.
    await expect(confirm.getByRole('alert')).toHaveText(
      "Couldn't undo the import. Try again in a moment.",
    );
    await expect(confirm.getByRole('heading', {name: 'Undo this import?'})).toBeVisible();
    expect(await countAfterToasts(page, page.locator('[data-sonner-toast]'))).toBe(0);
    expect(api.undos).toEqual([]);
    await confirm.getByRole('button', {name: 'Undo import'}).click();
    await expect(page.getByText('Import undone')).toBeVisible();
    await expect(confirm).toBeHidden();
    expect(api.undos).toEqual(['00000000-0000-4000-8000-000000000511']);
    await expect(rows.first()).toContainText('Undone 12 Nov');
    await expect(rows.first().getByRole('button', {name: /^Undo/})).toHaveCount(0);

    // Its summary opens with what the undo did, and its counts as what the import found when it ran.
    await rows.first().getByRole('button', {name: '3 files', exact: true}).click();
    const summary = page.getByRole('dialog', {name: 'Import undone'});
    await expect(summary.getByRole('heading', {name: 'Import undone'})).toBeVisible();
    await expect(summary.getByRole('heading', {name: /^Imported/})).toHaveCount(0);
    const undoneAlert = summary.getByTestId('bank-import-undone');
    await expect(undoneAlert).toContainText('This import was undone today');
    await expect(undoneAlert).toContainText(
      'The transactions it added were removed, except any that bank sync had picked up by then.',
    );
    const counts = summary.getByRole('region', {name: 'When imported'});
    await expect(counts.getByText('Were new', {exact: true}).locator('..')).toContainText('212');
    await expect(
      counts.getByText('Were already in Wisp', {exact: true}).locator('..'),
    ).toContainText('98');
    await expect(summary.getByText('New transactions')).toHaveCount(0);
    const wentTo = summary.getByTestId('bank-import-accounts').getByRole('listitem');
    await expect(wentTo).toHaveCount(2);
    await expect(wentTo.nth(0).getByTestId('bank-logo')).toBeVisible();
    await expect(wentTo.nth(0)).toContainText('Current account · ••1234 · EUR · Mock ASPSP');
    // A name that already ends with its currency is not followed by it again.
    await expect(wentTo.nth(1)).toContainText('Example Card · EUR');
    await expect(wentTo.nth(1)).toContainText('New account · Imported files');
    await expect(wentTo.nth(1).getByTestId('bank-logo')).toHaveCount(0);
    await expect(summary.getByRole('button', {name: 'Undo import'})).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');

    // With its only import undone, the file account has no file left to run up to.
    await page.getByRole('tab', {name: 'Accounts'}).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(fileFreshness).toContainText('No statement file yet');
  });

  test('Review opens the rows an import still has to check', async ({page}) => {
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await mockFileImport(page, {imports: [importSummary({rowsDoubtful: 3})]});
    await page.goto('/accounts?tab=imports');

    const row = page.getByTestId('bank-import-row');
    await expect(row.getByRole('button', {name: 'Undo import from 12 Nov'})).toBeVisible();
    await row.getByRole('button', {name: 'Review import from 12 Nov'}).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', {name: 'Check 3 transactions'}),
    ).toBeVisible();
  });

  test("an account's page lists only the imports that wrote to it, with Undo, and says which dates it covers", async ({
    page,
  }) => {
    const mine = importSummary({
      id: '00000000-0000-4000-8000-000000000531',
      rowsDoubtful: 0,
      accounts: [{id: FILE_ACCOUNT_ID, name: null, currency: 'EUR', created: true}],
    });
    const other = importSummary({
      id: '00000000-0000-4000-8000-000000000532',
      rowsDoubtful: 0,
      createdAt: '2026-11-10T08:00:00.000Z',
    });
    await mockBankConnections(page, [MOCK_CONNECTION, IMPORTED_FILES]);
    const api = await mockFileImport(page, {imports: [mine, other]});
    await page.goto('/accounts');

    await openAccount(page, FILE_ACCOUNT_ID);
    await expect(page.getByRole('heading', {name: 'Example Card · EUR', level: 1})).toBeVisible();
    const imports = page.getByRole('region', {name: 'Imports for this account'});
    await expect(imports.getByTestId('bank-import-row')).toHaveCount(1);
    const about = page.getByTestId('account-about');
    await expect(about).toContainText('Statement files');
    await expect(about.getByRole('button', {name: 'Import a newer file'})).toBeVisible();
    await expect(page.getByTestId('account-connection')).toHaveCount(0);

    await imports.getByRole('button', {name: 'Undo import from 12 Nov'}).click();
    await page.getByRole('dialog').getByRole('button', {name: 'Undo import'}).click();
    await expect(page.getByText('Import undone')).toBeVisible();
    expect(api.undos).toEqual([mine.id]);
    await expect(imports.getByTestId('bank-import-row')).toContainText('Undone 12 Nov');
  });

  test('offers Add balance or Edit on imported-files accounts as their balance comes, in a dialog', async ({
    page,
  }) => {
    test.setTimeout(20_000);
    const [base] = IMPORTED_FILES.bankAccounts;
    const accounts = [
      {
        ...base,
        id: FILE_ACCOUNT_ID,
        name: 'Example Wallet',
        currentBalanceAmount: null,
        balanceSource: null,
      },
      {
        ...base,
        id: '00000000-0000-4000-8000-000000000402',
        name: 'Example Savings',
        currentBalanceAmount: '-42.10000000',
        balanceSource: 'stated',
      },
      {
        ...base,
        id: '00000000-0000-4000-8000-000000000403',
        name: 'Example Statement',
        currentBalanceAmount: '310.00000000',
        balanceSource: 'file',
      },
    ] satisfies BankConnection['bankAccounts'];
    let connections: BankConnection[] = [{...IMPORTED_FILES, bankAccounts: accounts}];
    await mockBankConnections(page, () => connections);
    await mockFileImport(page);
    const amounts = await mockSetBalance(page, (account) => {
      connections = [
        {
          ...IMPORTED_FILES,
          bankAccounts: accounts.map((existing) =>
            existing.id === account.id ? {...existing, ...account, name: existing.name} : existing,
          ),
        },
      ];
    });
    await page.goto('/accounts');
    const rowOf = (name: string) =>
      page.getByTestId(/^account-row-/).filter({has: page.getByRole('link', {name})});

    // No balance: Add balance where the amount would be.
    await expect(
      rowOf('Example Wallet').getByRole('button', {name: 'Add balance of Example Wallet'}),
    ).toHaveText('Add balance');
    await expect(rowOf('Example Wallet')).not.toContainText('€');
    // Entered by the owner: the amount and a quiet Edit.
    await expect(rowOf('Example Savings')).toContainText('-€42.10');
    await expect(
      rowOf('Example Savings').getByRole('button', {name: 'Edit balance of Example Savings'}),
    ).toHaveText('Edit');
    // Stated by its statements: the amount and the row's Import a file only.
    await expect(rowOf('Example Statement')).toContainText('€310.00');
    await expect(rowOf('Example Statement').getByRole('button', {name: /balance/})).toHaveCount(0);
    // The rest of a row with an action still opens the account's page.
    await expect(rowOf('Example Wallet').getByRole('link')).toHaveAttribute(
      'href',
      new RegExp(`/accounts/${FILE_ACCOUNT_ID}$`),
    );

    await rowOf('Example Savings')
      .getByRole('button', {name: 'Edit balance of Example Savings'})
      .click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', {name: 'Edit balance'})).toBeVisible();
    await expect(dialog.getByLabel('Balance of Example Savings today')).toHaveValue('-42.10');
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog).toBeHidden();
    expect(amounts).toEqual([]);

    await rowOf('Example Wallet')
      .getByRole('button', {name: 'Add balance of Example Wallet'})
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', {name: 'Add balance'})).toBeVisible();
    await expect(
      dialog.getByText('Wisp works out earlier balances from your transactions.'),
    ).toBeVisible();
    const field = dialog.getByLabel('Balance of Example Wallet today');
    await animationsSettled(dialog);
    await expectCurrencyInside(field, 'EUR');
    // Cancel and Save under the field, Save last.
    const [fieldBox, cancelBox, saveBox] = await Promise.all([
      boxOf(field),
      boxOf(dialog.getByRole('button', {name: 'Cancel'})),
      boxOf(dialog.getByRole('button', {name: 'Save'})),
    ]);
    expect(cancelBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    expect(saveBox.y).toBe(cancelBox.y);
    expect(saveBox.x).toBeGreaterThan(cancelBox.x);
    await field.fill('99.5');
    await dialog.getByRole('button', {name: 'Save'}).click();

    await expect(dialog).toBeHidden();
    expect(amounts).toEqual(['99.5']);
    await expect(rowOf('Example Wallet')).toContainText('€99.50');
    await expect(
      rowOf('Example Wallet').getByRole('button', {name: 'Edit balance of Example Wallet'}),
    ).toBeVisible();

    // On a phone the dialog is a sheet: Save over Cancel, full width under the field, and Enter saves.
    await page.setViewportSize({width: 390, height: 844});
    await rowOf('Example Savings')
      .getByRole('button', {name: 'Edit balance of Example Savings'})
      .click();
    dialog = page.getByRole('dialog');
    const phoneField = dialog.getByLabel('Balance of Example Savings today');
    await expectInsideViewport(page, dialog.getByRole('button', {name: 'Cancel'}));
    await animationsSettled(dialog);
    await expectCurrencyInside(phoneField, 'EUR');
    const [phoneFieldBox, phoneSave, phoneCancel] = await Promise.all([
      boxOf(phoneField),
      boxOf(dialog.getByRole('button', {name: 'Save'})),
      boxOf(dialog.getByRole('button', {name: 'Cancel'})),
    ]);
    expect(phoneSave.y).toBeGreaterThanOrEqual(phoneFieldBox.y + phoneFieldBox.height);
    expect(phoneCancel.y).toBeGreaterThan(phoneSave.y);
    expect(Math.abs(phoneSave.width - phoneFieldBox.width)).toBeLessThanOrEqual(1);
    await phoneField.fill('-40.00');
    await phoneField.press('Enter');
    await expect(dialog).toBeHidden();
    expect(amounts).toEqual(['99.5', '-40.00']);
    await expect(rowOf('Example Savings')).toContainText('-€40.00');
  });

  test('shows imported-files accounts with no consent, sync or reconnecting', async ({page}) => {
    let fileRefreshes = 0;
    await page.route(`${API_URL}/bank-connections/${IMPORTED_FILES.id}/refresh`, (route) => {
      fileRefreshes += 1;
      return route.fulfill({status: 409});
    });
    await mockBankConnections(page, [IMPORTED_FILES, MOCK_CONNECTION]);
    await mockFileImport(page);
    await page.goto('/accounts');

    const row = accountRow(page, FILE_ACCOUNT_ID);
    await expect(row.getByRole('link', {name: 'Example Card · EUR'})).toBeVisible();
    await expect(row).toContainText('statement files');
    await expect(row.getByTestId('account-bank-logo').locator('svg')).toBeVisible();
    await expect(row.getByTestId('account-freshness')).toHaveText(
      'No statement file yetImport a file',
    );
    await expect(row.getByRole('button', {name: 'Reconnect'})).toHaveCount(0);
    // No bank needs attention, so the navigation carries no dot.
    await expect(page.getByRole('link', {name: /needs attention|re-authorizing/})).toHaveCount(0);

    await openAccount(page, FILE_ACCOUNT_ID);
    const about = page.getByTestId('account-about');
    await expect(about).toContainText('Statement files');
    for (const label of ['Country', 'Access until', 'Updated'])
      await expect(page.getByText(label, {exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Reconnect'})).toHaveCount(0);
    await expect(
      page.getByTestId('account-settings').getByRole('button', {name: 'Remove account'}),
    ).toBeVisible();
    expect(fileRefreshes).toBe(0);
  });
});
