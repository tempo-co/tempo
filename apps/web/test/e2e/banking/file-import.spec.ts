import type {Page, Request, Route} from '@playwright/test';
import type {
  BankConnection,
  BankImportDoubtfulRow,
  BankImportError,
  BankImportSummary,
  ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';
import {openDetails, routeMockedBankApp} from '../../utils/bank-connections';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const TODAY = new Date('2026-11-12T10:00:00+01:00');
const CHECKING = MOCK_CONNECTION.bankAccounts[0];
const FILE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000401';

/** Synthetic statement files: their content never reaches a parser in these specs. */
const statement = (name: string) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(`synthetic statement ${name}`),
});

function importSummary(fields: Partial<BankImportSummary> = {}): BankImportSummary {
  return {
    id: '00000000-0000-4000-8000-000000000501',
    format: 'camt053',
    filesCount: 3,
    rowsParsed: 313,
    rowsAdded: 212,
    rowsAlreadyPresent: 98,
    rowsMatchedByReference: 90,
    rowsMatchedByBalance: 8,
    rowsMatchedByDate: 0,
    rowsDoubtful: 3,
    dateFrom: '2026-05-01',
    dateTo: '2026-10-30',
    accounts: [{id: CHECKING.id, name: 'Holder Name', currency: 'EUR', created: false}],
    undoneAt: null,
    createdAt: '2026-11-12T09:30:00.000Z',
    ...fields,
  };
}

const IMPORTED_FILES: BankConnection = {
  ...MOCK_CONNECTION,
  id: '00000000-0000-4000-8000-000000000400',
  provider: 'file',
  aspspName: 'Imported files',
  aspspCountry: 'ZZ',
  consentValidUntil: null,
  lastSyncedAt: null,
  lastSuccessfulSyncAt: null,
  nextSyncAt: null,
  syncStatus: 'IDLE',
  bankAccounts: [
    {
      ...CHECKING,
      id: FILE_ACCOUNT_ID,
      name: 'Example Card · EUR',
      details: null,
      cashAccountType: null,
      maskedIdentifier: null,
      currentBalanceAmount: '-42.10',
    },
  ],
};

type ImportApi = {
  imports: BankImportSummary[];
  uploads: Request[];
  resolves: ResolveBankImportDoubtfulRowRequest[];
  undos: string[];
};

/**
 * File import on: the import list, then `answer` for each upload in turn. Doubtful rows and their answers, and
 * undo, keep the list in step like the API does.
 */
async function mockFileImport(
  page: Page,
  {
    imports = [],
    uploads = [],
    doubtfulRows = [],
  }: {
    imports?: BankImportSummary[];
    uploads?: ((route: Route, api: ImportApi) => Promise<void>)[];
    doubtfulRows?: BankImportDoubtfulRow[];
  } = {},
) {
  const api: ImportApi = {imports: [...imports], uploads: [], resolves: [], undos: []};
  await page.route(`${API_URL}/bank-imports`, async (route) => {
    if (route.request().method() === 'GET') return fulfillJson(route, api.imports);
    api.uploads.push(route.request());
    const answer = uploads.shift();
    if (!answer) throw new Error('Unexpected upload');
    await answer(route, api);
  });
  await page.route(`${API_URL}/bank-imports/*/doubtful-rows`, (route) =>
    fulfillJson(route, doubtfulRows),
  );
  await page.route(`${API_URL}/bank-imports/*/doubtful-rows/*/resolve`, (route) => {
    const request = route.request().postDataJSON() as ResolveBankImportDoubtfulRowRequest;
    api.resolves.push(request);
    const [current] = api.imports;
    const next = {
      ...current,
      rowsDoubtful: current.rowsDoubtful - 1,
      rowsAdded: current.rowsAdded + (request.decision === 'new' ? 1 : 0),
      rowsAlreadyPresent: current.rowsAlreadyPresent + (request.decision === 'new' ? 0 : 1),
    };
    api.imports = [next, ...api.imports.slice(1)];
    return fulfillJson(route, next);
  });
  await page.route(`${API_URL}/bank-imports/*`, (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    api.undos.push(id);
    api.imports = api.imports.map((summary) =>
      summary.id === id ? {...summary, undoneAt: TODAY.toISOString(), rowsDoubtful: 0} : summary,
    );
    return route.fulfill({status: 204});
  });
  return api;
}

/** A drop the API imported: it heads the import list from then on. */
const created = (summary: BankImportSummary) => (route: Route, api: ImportApi) => {
  api.imports = [summary, ...api.imports.filter(({id}) => id !== summary.id)];
  return fulfillJson(route, summary, 201);
};
const refused =
  (error: Partial<BankImportError> & Pick<BankImportError, 'code'>) => (route: Route) =>
    fulfillJson(
      route,
      {statusCode: 422, message: 'Refused.', file: null, ...error},
      error.statusCode ?? 422,
    );

/** The multipart form an upload sent: its file names in order and its text fields. */
function sentForm(request: Request) {
  const body = request.postDataBuffer()?.toString('latin1') ?? '';
  const files = [...body.matchAll(/name="files"; filename="([^"]*)"/g)].map((match) => match[1]);
  const fields = Object.fromEntries(
    [...body.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)].map((match) => [match[1], match[2]]),
  );
  return {files, fields};
}

async function openImport(page: Page) {
  await page.getByRole('button', {name: 'Import a file'}).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', {name: 'Import a file'})).toBeVisible();
  return dialog;
}

test.describe('statement file import on Connections', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    serviceWorkers: 'block',
    timezoneId: 'Europe/Amsterdam',
  });

  test.beforeEach(async ({page, baseURL}) => {
    await page.clock.setFixedTime(TODAY);
    await routeMockedBankApp(page, baseURL);
    await mockBankConnections(page, [MOCK_CONNECTION]);
  });

  test('leaves the page as it was while the deployment has import off, without moving it as it answers', async ({
    page,
  }) => {
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let probes = 0;
    await page.route(`${API_URL}/bank-imports`, async (route) => {
      probes += 1;
      await answered;
      await fulfillJson(route, {statusCode: 404, message: 'Not Found'}, 404);
    });

    await page.goto('/bank-connections');
    const connect = page.getByRole('button', {name: 'Connect a bank'});
    await expect(page.getByRole('region', {name: 'Mock ASPSP'})).toBeVisible();
    const before = await boxOf(connect);
    await expect(page.getByRole('button', {name: 'Import a file'})).toHaveCount(0);

    release();
    await expect.poll(() => probes).toBe(1);
    await page.waitForTimeout(300);
    expect(await boxOf(connect)).toEqual(before);
    await expect(page.getByRole('button', {name: 'Import a file'})).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'Imports'})).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    // A 404 is the answer, so it is not asked again.
    expect(probes).toBe(1);
  });

  test('imports chosen files and shows what they added, where they went and when', async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const summary = importSummary();
    const api = await mockFileImport(page, {
      uploads: [
        async (route, api) => {
          await held;
          await created(summary)(route, api);
        },
      ],
    });

    await page.goto('/bank-connections');
    // Sync stays the page's main path; import sits beside it.
    const connect = page.getByRole('button', {name: 'Connect a bank'});
    const importButton = page.getByRole('button', {name: 'Import a file'});
    await expect(importButton).toBeVisible();
    await expect(connect).toHaveCSS('background-color', await bgOf(page, 'bg-primary'));
    const [importBox, connectBox] = await Promise.all([boxOf(importButton), boxOf(connect)]);
    expect(importBox.x + importBox.width).toBeLessThan(connectBox.x);

    const dialog = await openImport(page);
    await expect(dialog.getByText('Drop statement files here')).toBeVisible();
    await expect(
      dialog.getByText(
        'CAMT.053, MT940, ABN AMRO TXT or a Revolut statement (CSV or Excel). Several files or a zip at once.',
      ),
    ).toBeVisible();
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([
        statement('statement-may.xml'),
        statement('statement-june.xml'),
        statement('statement-july.xml'),
      ]);

    await expect(dialog.getByRole('button', {name: 'Importing…'})).toBeDisabled();
    await expect(
      dialog.getByRole('list', {name: 'Chosen files'}).getByRole('listitem'),
    ).toHaveCount(3);
    release();

    await expect(dialog.getByRole('heading', {name: 'Imported 3 files'})).toBeVisible();
    const summaryBody = dialog.getByTestId('bank-import-summary');
    for (const [label, value] of [
      ['New transactions', '212'],
      ['Already in Tempo', '98'],
      ['Need a look', '3'],
    ]) {
      await expect(summaryBody.getByText(label, {exact: true}).locator('..')).toContainText(value);
    }
    await expect(summaryBody.getByText('3', {exact: true})).toHaveClass(/text-warning/);
    await expect(summaryBody.getByText('1 May – 30 Oct 2026')).toBeVisible();
    // The account goes by the name Connections gives it, not the provider's holder name.
    await expect(summaryBody.getByText('Mock ASPSP checking account · EUR')).toBeVisible();
    await expect(dialog.getByRole('button', {name: 'Review 3 rows'})).toBeVisible();
    await expect(dialog.getByRole('button', {name: 'Undo import'})).toBeVisible();

    expect(api.uploads).toHaveLength(1);
    const form = sentForm(api.uploads[0]);
    expect(form.files).toEqual(['statement-may.xml', 'statement-june.xml', 'statement-july.xml']);
    expect(form.fields).toEqual({});

    // Done closes it, and focus returns to the button that opened it.
    await dialog.getByRole('button', {name: 'Done'}).click();
    await expect(dialog).toBeHidden();
    await expect(importButton).toBeFocused();
    // The new import heads the list under the cards.
    const row = page.getByTestId('bank-import-row').first();
    await expect(row).toContainText('3 files · 212 new');
    await expect(row).toContainText('Today · Mock ASPSP checking account · 3 need a look');
  });

  test('says when everything in the files was already there', async ({page}) => {
    await mockFileImport(page, {
      uploads: [
        created(
          importSummary({filesCount: 2, rowsAdded: 0, rowsAlreadyPresent: 313, rowsDoubtful: 0}),
        ),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-a.xml'), statement('statement-b.xml')]);

    await expect(dialog.getByRole('heading', {name: 'Imported 2 files'})).toBeVisible();
    await expect(dialog.getByText('Nothing new in these files')).toBeVisible();
    await expect(dialog.getByText('All 313 transactions are already in Tempo.')).toBeVisible();
    await expect(dialog.getByText('New transactions')).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: /^Review/})).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: 'Done'})).toHaveCSS(
      'background-color',
      await bgOf(page, 'bg-primary'),
    );
  });

  test('a refusal names the refused file, says nothing was imported and lets other files be chosen', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {
      uploads: [refused({code: 'parse_failed', file: 2}), created(importSummary({filesCount: 1}))],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-april.xml'), statement('statement-march.xml')]);

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("This file couldn't be read")).toBeVisible();
    await expect(alert).toContainText(
      "statement-march.xml: Something in it doesn't add up. Download it again from your bank and retry. Nothing was imported.",
    );
    // The refused files are not kept; the owner chooses again without reopening.
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toHaveCount(0);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-april.xml')]);
    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    expect(api.uploads).toHaveLength(2);
  });

  test('asks which account a statement is, then sends the same files with the answer', async ({
    page,
  }) => {
    const savings = MOCK_CONNECTION.bankAccounts[1];
    const api = await mockFileImport(page, {
      uploads: [
        refused({
          statusCode: 409,
          code: 'target_account_unconfirmed',
          accountQuestions: [
            {
              bank: 'Example Bank',
              currency: 'EUR',
              candidates: [
                {
                  bankAccountId: CHECKING.id,
                  name: 'Everyday',
                  currency: 'EUR',
                  bankName: 'Example Bank',
                  imported: false,
                },
                {
                  bankAccountId: savings.id,
                  name: null,
                  currency: 'EUR',
                  bankName: 'Imported files',
                  imported: true,
                },
              ],
            },
          ],
        }),
        created(importSummary({filesCount: 1})),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.csv')]);

    await expect(dialog.getByRole('heading', {name: 'Which account is this?'})).toBeVisible();
    const question = dialog.getByRole('group', {name: 'Example Bank · EUR'});
    await expect(
      question.getByText('Few of these transactions match what Tempo already has for Everyday.'),
    ).toBeVisible();
    const radios = question.getByRole('radio');
    await expect(radios).toHaveCount(3);
    for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
    await expect(question.getByText('Keeps these transactions separate')).toBeVisible();
    const importButton = dialog.getByRole('button', {name: 'Import', exact: true});
    await expect(importButton).toBeDisabled();

    // Arrow keys move between the choices.
    await radios.first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(question.getByRole('radio', {name: /Imported files/})).toBeChecked();
    await question.getByText('Everyday', {exact: true}).click();
    await expect(importButton).toBeEnabled();
    await importButton.click();

    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    expect(api.uploads).toHaveLength(2);
    const retry = sentForm(api.uploads[1]);
    // The same file goes again, with the answer.
    expect(retry.files).toEqual(['statement.csv']);
    expect(JSON.parse(retry.fields.accountChoices)).toEqual({'Example Bank:EUR': CHECKING.id});
  });

  test('a new account answers the question too, and Cancel goes back to choosing files', async ({
    page,
  }) => {
    const question = {
      statusCode: 409,
      code: 'ambiguous_target_account' as const,
      accountQuestions: [
        {
          bank: 'Example Bank',
          currency: 'EUR',
          candidates: [
            {
              bankAccountId: CHECKING.id,
              name: 'Everyday',
              currency: 'EUR',
              bankName: 'Example Bank',
              imported: false,
            },
          ],
        },
        {bank: 'Example Bank', currency: 'USD', candidates: []},
      ],
    };
    const api = await mockFileImport(page, {
      uploads: [refused(question), refused(question), created(importSummary({filesCount: 1}))],
    });
    await page.goto('/bank-connections');
    let dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.csv')]);
    await expect(dialog.getByText('You have more than one account this could be.')).toHaveCount(2);
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog.getByRole('heading', {name: 'Import a file'})).toBeVisible();

    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.csv')]);
    for (const currency of ['EUR', 'USD'])
      await dialog
        .getByRole('group', {name: `Example Bank · ${currency}`})
        .getByText('A new account')
        .click();
    await dialog.getByRole('button', {name: 'Import', exact: true}).click();
    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    const retry = sentForm(api.uploads[2]);
    expect(JSON.parse(retry.fields.accountChoices)).toEqual({
      'Example Bank:EUR': 'new',
      'Example Bank:USD': 'new',
    });

    // A statement that names its own account has nothing to ask: a plain refusal.
    await page.unroute(`${API_URL}/bank-imports`);
    await mockFileImport(page, {
      uploads: [refused({statusCode: 409, code: 'ambiguous_target_account', accountQuestions: []})],
    });
    await dialog.getByRole('button', {name: 'Done'}).click();
    dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.xml')]);
    await expect(dialog.getByRole('alert')).toContainText(
      'This file fits more than one account' +
        'More than one of your accounts has the account number this file names. Nothing was imported.',
    );
  });

  test('reviews doubtful rows in place with either answer, then returns to the summary', async ({
    page,
  }) => {
    const summary = importSummary({rowsDoubtful: 2});
    const rows: BankImportDoubtfulRow[] = [
      doubtfulRow('00000000-0000-4000-8000-000000000601', 'Example Grocer', '-23.40', [
        candidate('00000000-0000-4000-8000-000000000701', 'Example Grocer', '-23.40'),
        candidate('00000000-0000-4000-8000-000000000702', 'Example Grocer Outlet', '-23.40'),
      ]),
      doubtfulRow('00000000-0000-4000-8000-000000000602', 'Example Refund', '12.00', [
        candidate('00000000-0000-4000-8000-000000000703', 'Example Refund', '12.00'),
      ]),
    ];
    const api = await mockFileImport(page, {imports: [summary], doubtfulRows: rows});
    await page.goto('/bank-connections');
    await page
      .getByTestId('bank-import-row')
      .getByRole('button', {name: '3 files · 212 new'})
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', {name: 'Review 2 rows'}).click();

    await expect(dialog.getByRole('heading', {name: 'Check 2 transactions'})).toBeVisible();
    const blocks = dialog.getByTestId('bank-import-doubtful-row');
    await expect(blocks).toHaveCount(2);
    const [first, second] = [blocks.nth(0), blocks.nth(1)];
    await expect(first).toContainText('Example Grocer');
    await expect(first).toContainText('1 Oct · from the file');
    await expect(first).toContainText('Could be the same as');
    await first.getByRole('button', {name: /^Same transaction as Example Grocer Outlet/}).click();
    await expect(first.getByText('Marked as the same')).toBeVisible();
    await expect(first.getByRole('button')).toHaveCount(0);

    await second.getByRole('button', {name: "It's a new transaction"}).click();
    // The last answer returns to the summary, with its counts.
    await expect(dialog.getByRole('heading', {name: 'Imported 3 files'})).toBeVisible();
    await expect(dialog.getByText('Need a look')).toHaveCount(0);
    await expect(dialog.getByText('New transactions', {exact: true}).locator('..')).toContainText(
      '213',
    );
    expect(api.resolves).toEqual([
      {decision: 'duplicate', transactionId: '00000000-0000-4000-8000-000000000702'},
      {decision: 'new'},
    ]);
  });

  test('lists imports newest first, undoes one after confirming and keeps it listed as undone', async ({
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
    await page.goto('/bank-connections');

    const list = page.getByTestId('bank-imports-list');
    await expect(page.getByRole('heading', {name: 'Imports'})).toBeVisible();
    await expect(list.getByTestId('bank-import-row')).toHaveCount(5);
    const rows = list.getByTestId('bank-import-row');
    await expect(rows.nth(1)).toContainText('1 file · nothing new');
    await expect(rows.nth(1)).toContainText('Yesterday');
    const undone = rows.nth(2);
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
    await expect(page.getByText('Import undone')).toBeVisible();
    await expect(confirm).toBeHidden();
    expect(api.undos).toEqual(['00000000-0000-4000-8000-000000000511']);
    await expect(rows.first()).toContainText('Undone 12 Nov');
    await expect(rows.first().getByRole('button', {name: /^Undo/})).toHaveCount(0);
  });

  test('shows imported files as a connection with no consent, sync or re-authorization', async ({
    page,
  }) => {
    let fileRefreshes = 0;
    await page.route(`${API_URL}/bank-connections/${IMPORTED_FILES.id}/refresh`, (route) => {
      fileRefreshes += 1;
      return route.fulfill({status: 409});
    });
    await mockBankConnections(page, [IMPORTED_FILES, MOCK_CONNECTION]);
    await mockFileImport(page);
    await page.goto('/bank-connections');

    const card = page.getByRole('region', {name: 'Imported files'});
    await expect(card).toBeVisible();
    await expect(card.getByText('From statement files')).toBeVisible();
    await expect(card.getByTestId('bank-connection-logo').locator('svg')).toBeVisible();
    await expect(card.getByTestId('bank-connection-problem')).toHaveCount(0);
    await expect(card.getByRole('link', {name: 'Example Card · EUR transactions'})).toHaveAttribute(
      'href',
      new RegExp(`bankAccountIds=.*${FILE_ACCOUNT_ID}`),
    );
    // No bank needs attention, so the navigation carries no dot.
    await expect(page.getByRole('link', {name: /needs attention|re-authorizing/})).toHaveCount(0);

    const details = await openDetails(page, card);
    await expect(details.getByRole('heading', {name: 'Imported files'})).toBeVisible();
    await expect(details.getByText('Accounts', {exact: true})).toBeVisible();
    for (const label of ['Country', 'Consent until', 'Updated'])
      await expect(details.getByText(label, {exact: true})).toHaveCount(0);
    await expect(details.getByRole('button', {name: 'Re-authorize'})).toHaveCount(0);
    await expect(details.getByRole('button', {name: 'Remove connection'})).toBeVisible();
    expect(fileRefreshes).toBe(0);
  });

  test('offers both ways in on an empty page, and imports files dropped anywhere on it', async ({
    page,
  }) => {
    await mockBankConnections(page, []);
    const api = await mockFileImport(page, {uploads: [created(importSummary({filesCount: 1}))]});
    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'No accounts yet'})).toBeVisible();
    await expect(
      page.getByText('Connect a bank to keep its accounts up to date, or import statement files.'),
    ).toBeVisible();
    // The header's pair and the empty page's pair.
    await expect(page.getByRole('button', {name: 'Connect a bank'})).toHaveCount(2);
    await expect(page.getByRole('button', {name: 'Import a file'})).toHaveCount(2);

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['synthetic'], 'dropped-statement.xml'));
      return data;
    });
    const column = page.getByTestId('bank-connections-list');
    await column.dispatchEvent('dragenter', {dataTransfer: transfer});
    await expect(page.getByTestId('bank-import-page-drop')).toContainText('Drop to import');
    await column.dispatchEvent('dragover', {dataTransfer: transfer});
    await column.dispatchEvent('drop', {dataTransfer: transfer});
    await expect(page.getByTestId('bank-import-page-drop')).toHaveCount(0);
    await expect(
      page.getByRole('dialog').getByRole('heading', {name: 'Imported 1 file'}),
    ).toBeVisible();
    expect(api.uploads).toHaveLength(1);
  });

  test('an import closed mid-upload still finishes, and its toast reopens the summary', async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await mockFileImport(page, {
      uploads: [
        async (route, api) => {
          await held;
          await created(importSummary())(route, api);
        },
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('a.xml'), statement('b.xml'), statement('c.xml')]);
    await expect(dialog.getByRole('button', {name: 'Importing…'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', {name: 'Import a file'})).toBeFocused();

    release();
    const toast = page.locator('[data-sonner-toast]').filter({hasText: 'Imported 3 files'});
    await expect(toast).toBeVisible();
    await toast.getByRole('button', {name: 'View'}).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', {name: 'Imported 3 files'}),
    ).toBeVisible();
  });

  test('files dropped while an earlier import is still uploading wait for it instead of starting another', async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const api = await mockFileImport(page, {
      uploads: [
        async (route, api) => {
          await held;
          await created(importSummary())(route, api);
        },
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('a.xml'), statement('b.xml'), statement('c.xml')]);
    await expect(dialog.getByRole('button', {name: 'Importing…'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['synthetic'], 'another-statement.xml'));
      return data;
    });
    const column = page.getByTestId('bank-connections-list');
    await column.dispatchEvent('dragenter', {dataTransfer: transfer});
    await column.dispatchEvent('dragover', {dataTransfer: transfer});
    await column.dispatchEvent('drop', {dataTransfer: transfer});
    await expect(page.getByTestId('bank-import-page-drop')).toHaveCount(0);
    expect(api.uploads).toHaveLength(1);

    // The running import still owns the dialog, and its result arrives as before.
    await page.getByRole('button', {name: 'Import a file'}).click();
    await expect(dialog.getByRole('button', {name: 'Importing…'})).toBeVisible();
    await expect(
      dialog.getByRole('list', {name: 'Chosen files'}).getByRole('listitem'),
    ).toHaveCount(3);
    release();
    await expect(dialog.getByRole('heading', {name: 'Imported 3 files'})).toBeVisible();
    expect(api.uploads).toHaveLength(1);
  });

  test('a lost connection keeps the chosen files for another try', async ({page}) => {
    await mockFileImport(page, {uploads: [(route) => route.abort('failed')]});
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-a.xml'), statement('statement-b.xml')]);

    // The api wrapper says the change was not confirmed; the dialog adds no second message.
    await expect(page.getByText(/Your change was not confirmed/)).toBeVisible();
    await expect(dialog.getByRole('heading', {name: 'Import a file'})).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(
      dialog.getByRole('list', {name: 'Chosen files'}).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(dialog.getByRole('button', {name: 'Import', exact: true})).toBeEnabled();
  });

  test.describe('worst-case data on phones', () => {
    const LONG_NAME =
      `${'example-bank-statement-current-account-'.repeat(3)}v3`.slice(0, 86) + '.xml';
    const LONG_ACCOUNT = 'Household shared everyday spending account with a long alias';

    test('keeps both header actions on one row and every state inside 390px and 320px', async ({
      page,
    }) => {
      test.setTimeout(40_000);
      expect(LONG_NAME).toHaveLength(90);
      expect(LONG_ACCOUNT).toHaveLength(60);
      await page.setViewportSize({width: 390, height: 844});
      const worst = importSummary({
        filesCount: 12,
        rowsAdded: 1_234_567,
        rowsAlreadyPresent: 7_654_321,
        rowsDoubtful: 40,
        accounts: [
          {id: CHECKING.id, name: null, currency: 'EUR', created: false},
          {id: FILE_ACCOUNT_ID, name: null, currency: 'EUR', created: true},
        ],
      });
      const rows = Array.from({length: 40}, (_, index) =>
        doubtfulRow(
          `00000000-0000-4000-8000-0000000008${String(index).padStart(2, '0')}`,
          `${LONG_ACCOUNT} payment ${index}`,
          '-1234567.89',
          [
            candidate(
              `00000000-0000-4000-8000-0000000009${String(index).padStart(2, '0')}`,
              LONG_ACCOUNT,
              '-1234567.89',
            ),
          ],
        ),
      );
      await mockBankConnections(page, [
        {
          ...MOCK_CONNECTION,
          bankAccounts: [{...CHECKING, alias: LONG_ACCOUNT, currentBalanceAmount: '-1234567.89'}],
        },
        {
          ...IMPORTED_FILES,
          bankAccounts: [{...IMPORTED_FILES.bankAccounts[0], alias: LONG_ACCOUNT}],
        },
      ]);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await mockFileImport(page, {
        imports: [worst],
        doubtfulRows: rows,
        uploads: [
          async (route, api) => {
            await held;
            await created(worst)(route, api);
          },
        ],
      });
      await page.goto('/bank-connections');

      const connect = page.getByRole('button', {name: 'Connect a bank'});
      const importButton = page.getByRole('button', {name: 'Import a file'});
      await expect(importButton).toBeVisible();
      const [title, importBox, connectBox] = await Promise.all([
        boxOf(page.getByRole('heading', {name: 'Bank connections'})),
        boxOf(importButton),
        boxOf(connect),
      ]);
      expect(importBox.y).toBeGreaterThan(title.y + title.height - 1);
      expect(importBox.y).toBe(connectBox.y);
      expect(Math.abs(importBox.width - connectBox.width)).toBeLessThanOrEqual(1);
      expect(importBox.height).toBeGreaterThanOrEqual(44);
      expect(connectBox.height).toBeGreaterThanOrEqual(44);

      for (const width of [390, 320]) {
        await page.setViewportSize({width, height: 700});
        await expectNoHorizontalOverflow(page);
      }

      // Phones choose files with the picker alone, then see every name in the drop and keep the footer in reach.
      const dialog = await openImport(page);
      await expect(dialog.getByTestId('bank-import-drop-area')).toHaveCount(0);
      const choose = dialog.getByRole('button', {name: 'Choose files'});
      expect((await boxOf(choose)).width).toBeGreaterThan(250);
      await dialog
        .getByTestId('bank-import-file-input')
        .setInputFiles(
          Array.from({length: 12}, (_, index) => statement(`${index}${LONG_NAME.slice(1)}`)),
        );
      const pending = dialog.getByRole('button', {name: 'Importing…'});
      await expect(pending).toBeVisible();
      await expectInsideViewport(page, pending);
      await expectNoHorizontalOverflow(page);
      await expectNothingWiderThan(dialog);
      release();

      await expect(dialog.getByRole('heading', {name: 'Imported 12 files'})).toBeVisible();
      await expect(dialog.getByText('1,234,567', {exact: true})).toBeVisible();
      await expectNothingWiderThan(dialog);
      const review = dialog.getByRole('button', {name: 'Review 40 rows'});
      await expectInsideViewport(page, review);
      await review.click();
      await expect(dialog.getByRole('heading', {name: 'Check 40 transactions'})).toBeVisible();
      await expect(dialog.getByTestId('bank-import-doubtful-row')).toHaveCount(40);
      // On phones the answer sits under the row, full width.
      const same = dialog.getByRole('button', {name: /^Same transaction/}).first();
      const block = dialog.getByTestId('bank-import-doubtful-row').first();
      expect((await boxOf(same)).width).toBeGreaterThan((await boxOf(block)).width - 2);
      await expectNothingWiderThan(dialog);
      // The body scrolls inside the sheet to the last row.
      const last = dialog.getByRole('button', {name: "It's a new transaction"}).last();
      await last.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, last);
      await expectNoHorizontalOverflow(page);
    });
  });
});

function doubtfulRow(
  id: string,
  description: string,
  amount: string,
  candidates: BankImportDoubtfulRow['candidates'],
): BankImportDoubtfulRow {
  return {
    id,
    bankAccountId: CHECKING.id,
    row: {
      bookingDate: '2026-10-01',
      valueDate: '2026-10-01',
      amount,
      currency: 'EUR',
      balanceAfter: null,
      bankReference: null,
      counterpartyName: null,
      description,
      remittanceInformation: null,
    },
    candidates,
  };
}

function candidate(id: string, description: string, amount: string) {
  return {
    id,
    transactionDate: '2026-10-01',
    bookingDate: '2026-10-01',
    valueDate: '2026-10-01',
    amount,
    currency: 'EUR',
    displayDescription: description,
    counterpartyName: null,
  };
}

/** A token's computed background, read from a probe so the check holds in either theme. */
async function bgOf(page: Page, className: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.className = name;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, className);
}

/** Polled: a phone sheet slides in, so its controls settle into place after it opens. */
async function expectInsideViewport(page: Page, locator: ReturnType<Page['locator']>) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await boxOf(locator);
      return box.y >= 0 && box.y + box.height <= viewport.height;
    })
    .toBe(true);
}

/** No element in `scope` reaches past the viewport's right edge. */
async function expectNothingWiderThan(scope: ReturnType<Page['locator']>) {
  await expect
    .poll(() =>
      scope.evaluate((root) => {
        const right = window.innerWidth;
        return [...root.querySelectorAll('*')]
          .filter((element) => element.getBoundingClientRect().right > right + 0.5)
          .map((element) => element.textContent?.slice(0, 40));
      }),
    )
    .toEqual([]);
}
