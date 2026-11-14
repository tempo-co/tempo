import type {Locator, Page, Request, Route} from '@playwright/test';
import type {
  BankConnection,
  BankImportDoubtfulRow,
  BankImportError,
  BankImportLayout,
  BankImportLayoutProposal,
  BankImportSummary,
  ConfirmBankImportLayoutProposalRequest,
  ResolveBankImportDoubtfulRowRequest,
  SetBankAccountBalanceRequest,
} from '@tempo/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';
import {openDetails, routeMockedBankApp} from '../../utils/bank-connections';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const TODAY = new Date('2026-11-12T10:00:00+01:00');
const CHECKING = MOCK_CONNECTION.bankAccounts[0];
const FILE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000401';
const LAYOUT_ID = '00000000-0000-4000-8000-000000000601';
const RESERVED_BANK_NAME =
  "Revolut's own exports already import into your Revolut accounts. Name this bank differently.";

/** A proposal for a synthetic German-style export: debit and credit columns, the account on a line above. */
function layoutProposal(fields: Partial<BankImportLayoutProposal> = {}): BankImportLayoutProposal {
  const row = (date: string, amount: string, counterparty: string, description: string) => ({
    date,
    amount,
    currency: 'EUR',
    counterparty,
    description,
    balanceAfter: null,
  });
  return {
    id: '00000000-0000-4000-8000-000000000701',
    expiresAt: '2026-11-12T10:00:00.000Z',
    bankName: 'Example Bank',
    currencyNeeded: false,
    defaultCurrency: 'EUR',
    mapping: {
      columns: [
        {field: 'date', column: 1, header: 'Buchungstag'},
        {field: 'moneyOut', column: 5, header: 'Soll'},
        {field: 'moneyIn', column: 6, header: 'Haben'},
        {field: 'currency', column: 7, header: 'Währung'},
        {field: 'counterparty', column: 3, header: 'Auftraggeber/Empfänger'},
        {field: 'description', column: 4, header: 'Verwendungszweck'},
      ],
      amount: 'debitCredit',
      direction: null,
      balance: null,
      accountLine: 2,
      dateFormat: 'DD.MM.YYYY',
    },
    dateCheck: null,
    preview: {
      rowCount: 9,
      dateFrom: '2026-03-02',
      dateTo: '2026-03-10',
      firstRows: [
        row('2026-03-02', '-12.50', 'Example Shop GmbH', 'Card payment Example Shop'),
        row('2026-03-03', '-850.00', 'Example Lettings GmbH', 'Rent March'),
        row('2026-03-04', '2500.00', 'Example Employer AG', 'Salary March'),
        row('2026-03-05', '-39.99', 'Example Shop GmbH', 'Card payment Example Shop'),
        row('2026-03-06', '-4.20', 'Example Cafe', 'Coffee'),
      ],
      lastRows: [
        row('2026-03-09', '-18.00', 'Example Cinema', 'Tickets'),
        row('2026-03-10', '45.00', 'Jan Example', 'Dinner share'),
      ],
      totals: [{currency: 'EUR', moneyIn: '2545.00', moneyOut: '944.69'}],
      accounts: ['DE89370400440532013000'],
    },
    ...fields,
  };
}

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
    layout: null,
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
    accountsWithoutBalance: [],
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
      balanceSource: 'file',
    },
  ],
};

type ImportApi = {
  imports: BankImportSummary[];
  uploads: Request[];
  resolves: ResolveBankImportDoubtfulRowRequest[];
  undos: string[];
  proposals: Request[];
  confirms: ConfirmBankImportLayoutProposalRequest[];
  rejects: string[];
  layouts: BankImportLayout[];
  removed: string[];
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
    mapper = false,
    proposals = [],
    layouts = [],
  }: {
    imports?: BankImportSummary[];
    uploads?: ((route: Route, api: ImportApi) => Promise<void>)[];
    doubtfulRows?: BankImportDoubtfulRow[];
    /** Whether the deployment works out the columns of a table it does not know. */
    mapper?: boolean;
    /** The answer to each proposal in turn. */
    proposals?: ((route: Route) => Promise<void>)[];
    layouts?: BankImportLayout[];
  } = {},
) {
  const api: ImportApi = {
    imports: [...imports],
    uploads: [],
    resolves: [],
    undos: [],
    proposals: [],
    confirms: [],
    rejects: [],
    layouts: [...layouts],
    removed: [],
  };
  await page.route(`${API_URL}/bank-imports`, async (route) => {
    if (route.request().method() === 'GET')
      return fulfillJson(route, {imports: api.imports, mapper});
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
  await page.route(`${API_URL}/bank-imports/layout-proposals`, async (route) => {
    api.proposals.push(route.request());
    const answer = proposals.shift();
    if (!answer) throw new Error('Unexpected proposal');
    await answer(route);
  });
  await page.route(`${API_URL}/bank-imports/layout-proposals/*/confirm`, (route) => {
    const request = route.request().postDataJSON() as ConfirmBankImportLayoutProposalRequest;
    api.confirms.push(request);
    if (request.bankName.trim().toLowerCase() === 'revolut')
      return fulfillJson(
        route,
        {statusCode: 400, message: RESERVED_BANK_NAME, error: 'Bad Request'},
        400,
      );
    const layout = {id: LAYOUT_ID, bankName: request.bankName, createdAt: TODAY.toISOString()};
    api.layouts = [layout, ...api.layouts];
    return fulfillJson(route, layout, 201);
  });
  await page.route(`${API_URL}/bank-imports/layout-proposals/*/reject`, (route) => {
    const segments = new URL(route.request().url()).pathname.split('/');
    api.rejects.push(segments[segments.length - 2]);
    return route.fulfill({status: 204});
  });
  await page.route(`${API_URL}/bank-imports/layouts`, (route) => fulfillJson(route, api.layouts));
  await page.route(`${API_URL}/bank-imports/layouts/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    api.removed.push(id);
    api.layouts = api.layouts.filter((layout) => layout.id !== id);
    return route.fulfill({status: 204});
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

/**
 * The balance route of the imported-files account: answers each request with the account and the balance it was
 * sent, after `hold` when given, and records the amounts.
 */
async function mockSetBalance(
  page: Page,
  onSaved: (account: BankConnection['bankAccounts'][number]) => void,
  hold?: Promise<void>,
) {
  const amounts: string[] = [];
  await page.route(`${API_URL}/bank-connections/*/accounts/*/balance`, async (route) => {
    const {amount} = route.request().postDataJSON() as SetBankAccountBalanceRequest;
    amounts.push(amount);
    const [accountId] = new URL(route.request().url()).pathname.split('/').slice(-2);
    expect(route.request().method()).toBe('PUT');
    expect(new URL(route.request().url()).pathname).toBe(
      `/bank-connections/${IMPORTED_FILES.id}/accounts/${accountId}/balance`,
    );
    await hold;
    const account = {
      ...IMPORTED_FILES.bankAccounts[0],
      id: accountId,
      currentBalanceAmount: `${amount}000000`,
      balanceUpdatedAt: '2026-11-12T00:00:00.000Z',
      balanceSource: 'stated' as const,
    };
    onSaved(account);
    await fulfillJson(route, account);
  });
  return amounts;
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

/** A proposal the API answered with, after `hold` when given. */
const proposed =
  (proposal: BankImportLayoutProposal, hold?: Promise<void>) => async (route: Route) => {
    await hold;
    await fulfillJson(route, proposal, 201);
  };

/** The multipart form an upload sent: its file names in order and its text fields. */
function sentForm(request: Request) {
  const body = request.postDataBuffer()?.toString('latin1') ?? '';
  const files = [...body.matchAll(/name="files"; filename="([^"]*)"/g)].map((match) => match[1]);
  const fields = Object.fromEntries(
    [...body.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)].map((match) => [match[1], match[2]]),
  );
  return {files, fields};
}

/**
 * A balance field shows its currency inside, at the far right, over the padding its value scrolls short of; and
 * names it in its description.
 */
async function expectCurrencyInside(field: Locator, currency: string) {
  const suffix = field.locator('xpath=..').getByText(currency, {exact: true});
  await expect(suffix).toBeVisible();
  await expect(field).toHaveAccessibleDescription(new RegExp(`^${currency} `));
  const [box, suffixBox, paddingRight] = await Promise.all([
    boxOf(field),
    boxOf(suffix),
    field.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight)),
  ]);
  expect(suffixBox.x + suffixBox.width).toBeLessThanOrEqual(box.x + box.width);
  expect(box.x + box.width - paddingRight).toBeLessThanOrEqual(suffixBox.x);
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
      dialog.getByText('Statement files from your bank, several at once or in a zip.'),
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
    // A synced account keeps the balance its bank reports: nothing to ask.
    await expect(dialog.getByTestId('bank-import-balances')).toHaveCount(0);
    await expect(dialog.getByText(/^Balance of/)).toHaveCount(0);

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
    // The refusal ends the dialog, under Supported files.
    const supportedFiles = dialog.getByRole('button', {name: 'Supported files'});
    expect((await boxOf(alert)).y).toBeGreaterThanOrEqual(
      (await boxOf(supportedFiles)).y + (await boxOf(supportedFiles)).height,
    );
    // The refused files are not kept; the owner chooses again without reopening.
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toHaveCount(0);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-april.xml')]);
    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    expect(api.uploads).toHaveLength(2);
  });

  test("lists the supported files, and a file laid out like a bank's export that doesn't read as one names the bank", async ({
    page,
  }) => {
    await mockFileImport(page, {
      uploads: [refused({code: 'layout_not_recognized', file: 1, layout: 'rabobank-nl'})],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);

    await dialog.getByRole('button', {name: 'Supported files'}).click();

    const supported = page.getByRole('dialog', {name: 'Supported files'});
    await expect(supported.getByText('CAMT.053, MT940, OFX and QFX')).toBeVisible();
    await expect(
      supported.getByRole('list', {name: 'Bank exports'}).getByRole('listitem'),
    ).toHaveText([
      /^ABN AMRO\s*TXT$/,
      /^ASN Bank\s*CSV$/,
      /^bunq\s*CSV$/,
      /^ING\s*CSV$/,
      /^Knab\s*CSV$/,
      /^Rabobank\s*CSV$/,
      /^Revolut\s*CSV and Excel$/,
    ]);
    // Closing the list goes back to choosing files, where it was opened.
    await page.keyboard.press('Escape');
    await expect(supported).toBeHidden();
    await expect(dialog.getByRole('heading', {name: 'Import a file'})).toBeVisible();
    await expect(dialog.getByRole('button', {name: 'Supported files'})).toBeFocused();

    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('transactions.csv')]);

    const alert = dialog.getByRole('alert');
    await expect(
      alert.getByText("This file doesn't look the way Rabobank's exports usually do"),
    ).toBeVisible();
    await expect(alert).toHaveText(
      /Tempo didn't import anything from it\. Try exporting it again, or use CAMT\.053 or MT940 if your bank offers them\.$/,
    );
    await expect(dialog.getByRole('button', {name: 'Choose files'})).toBeVisible();
  });

  test('a file in no layout Tempo knows says so while working out columns is off, and offers nothing more', async ({
    page,
  }) => {
    await mockFileImport(page, {uploads: [refused({code: 'layout_unknown', file: 1})]});
    await page.goto('/bank-connections');
    const dialog = await openImport(page);

    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('transactions.csv')]);

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("Tempo doesn't know this file's layout yet")).toBeVisible();
    await expect(alert).toContainText("It isn't a layout Tempo knows yet. Nothing was imported.");
    await expect(dialog.getByRole('button', {name: 'Work out the columns'})).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: 'Supported files'})).toBeVisible();
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toHaveCount(0);
  });

  test("works out an unknown file's columns, previews the owner's rows and imports the same drop once they look right", async ({
    page,
  }) => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    const api = await mockFileImport(page, {
      mapper: true,
      uploads: [
        refused({code: 'layout_unknown', file: 2}),
        created(importSummary({filesCount: 2, format: 'csv', layout: `learned-${LAYOUT_ID}`})),
      ],
      proposals: [proposed(layoutProposal(), held)],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-april.xml'), statement('export-example.csv')]);

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("Tempo doesn't know this file's layout yet")).toBeVisible();
    await expect(alert).toContainText(
      'export-example.csv: Tempo can work out which column is which. It sends the column headings and the shape of a few rows, with letters and digits masked, to its AI service. Nothing was imported.',
    );
    // The drop stays chosen, so it can go again once the columns are known.
    await expect(
      dialog.getByRole('list', {name: 'Chosen files'}).getByRole('listitem'),
    ).toHaveCount(2);
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();

    const working = dialog.getByRole('status').filter({hasText: 'Working out the columns…'});
    await expect(working).toBeVisible();
    // The spinner sits on the text's line.
    const [line, spinner] = [await boxOf(working), await boxOf(working.locator('svg'))];
    expect(line.height).toBeLessThan(28);
    expect(spinner.y).toBeGreaterThanOrEqual(line.y);
    expect(spinner.y + spinner.height).toBeLessThanOrEqual(line.y + line.height);
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeEnabled();
    answer();

    await expect(dialog.getByRole('heading', {name: 'Check the columns'})).toBeVisible();
    // Only the refused file went to be worked out.
    expect(sentForm(api.proposals[0]).files).toEqual(['export-example.csv']);
    const preview = dialog.getByTestId('bank-import-layout-preview');
    await expect(preview).toContainText(
      'Date: column 1 · Money out: column 5 · Money in: column 6 · Currency: column 7 · Name: column 3 · Description: column 4 · Account: line 2 above the table · Dates written DD.MM.YYYY',
    );
    await expect(preview.getByText('9 transactions · 2 Mar – 10 Mar 2026')).toBeVisible();
    const rows = preview.getByTestId('bank-import-layout-row');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText('Card payment Example Shop');
    await expect(rows.first()).toContainText('-€12.50');
    await expect(rows.first()).toContainText('money out');
    await expect(rows.nth(2)).toContainText('€2,500.00');
    await expect(rows.nth(2)).toContainText('money in');
    await expect(preview.getByText('2 more')).toBeVisible();
    await expect(preview.getByTestId('bank-import-layout-totals')).toHaveText(
      /Money in\s*€2,545.00\s*Money out\s*-€944.69/,
    );
    await expect(preview.getByText('Account DE89370400440532013000')).toBeVisible();
    await expect(preview.getByTestId('bank-import-date-check')).toHaveCount(0);
    await expect(preview.getByLabel('Bank')).toHaveValue('Example Bank');
    await expect(preview.getByLabel('Currency')).toHaveCount(0);

    await dialog.getByRole('button', {name: 'Looks right'}).click();

    await expect(dialog.getByRole('heading', {name: 'Imported 2 files'})).toBeVisible();
    expect(api.confirms).toEqual([{bankName: 'Example Bank'}]);
    // The same drop went again, unchanged.
    expect(api.uploads.map((upload) => sentForm(upload).files)).toEqual([
      ['statement-april.xml', 'export-example.csv'],
      ['statement-april.xml', 'export-example.csv'],
    ]);
  });

  test('a file whose dates read both ways asks for a check, and one that names no currency or bank asks for them', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {
      mapper: true,
      uploads: [
        refused({code: 'layout_not_recognized', file: 1, layout: 'rabobank-nl'}),
        created(importSummary({filesCount: 1, format: 'csv'})),
      ],
      proposals: [
        proposed(
          layoutProposal({
            bankName: null,
            currencyNeeded: true,
            dateCheck: {written: '03/04/2026', date: '2026-04-03'},
            preview: {
              ...layoutProposal().preview,
              firstRows: layoutProposal().preview.firstRows.map((row, index) => ({
                ...row,
                balanceAfter: index === 0 ? '995.50' : null,
              })),
            },
          }),
        ),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('transactions.csv')]);
    // A file that only looks like a known export keeps that bank's advice beside the offer.
    const alert = dialog.getByRole('alert');
    await expect(
      alert.getByText("This file doesn't look the way Rabobank's exports usually do"),
    ).toBeVisible();
    await expect(alert).toContainText(
      'Try exporting it again, or use CAMT.053 or MT940 if your bank offers them. Tempo can also work out which column is which.',
    );
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();

    const preview = dialog.getByTestId('bank-import-layout-preview');
    await expect(preview.getByTestId('bank-import-date-check')).toContainText(
      'Tempo read 03/04/2026 as 3 April 2026',
    );
    const confirm = dialog.getByRole('button', {name: 'Looks right'});
    await expect(preview.getByLabel('Bank')).toHaveValue('');
    await expect(confirm).toBeDisabled();
    // A name the API refuses says why under the field, and the preview stays.
    await preview.getByLabel('Bank').fill('Revolut');
    await confirm.click();
    await expect(preview.getByText(RESERVED_BANK_NAME)).toBeVisible();
    await expect(preview.getByLabel('Bank')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText("Couldn't save this layout")).toHaveCount(0);
    await preview.getByLabel('Bank').fill('  Example Savings Bank ');
    await expect(preview.getByText(RESERVED_BANK_NAME)).toHaveCount(0);
    await expect(preview.getByLabel('Currency')).toHaveText('EUR');
    await preview.getByLabel('Currency').click();
    await page.getByRole('option', {name: 'GBP'}).click();
    await expect(preview.getByTestId('bank-import-layout-totals')).toContainText('£2,545.00');
    // A balance column shows on each row, in the chosen currency.
    await expect(preview.getByTestId('bank-import-layout-row').first()).toContainText(
      'Balance £995.50',
    );

    await confirm.click();

    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    expect(api.confirms).toEqual([
      {bankName: 'Revolut', currency: 'EUR'},
      {bankName: 'Example Savings Bank', currency: 'GBP'},
    ]);
  });

  test('Not right discards the proposal and imports nothing; Cancel or closing stops waiting and keeps the files', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {
      mapper: true,
      uploads: [refused({code: 'layout_unknown', file: 1})],
      proposals: [
        proposed(layoutProposal(), new Promise<void>(() => undefined)),
        proposed(layoutProposal(), new Promise<void>(() => undefined)),
        proposed(layoutProposal()),
      ],
    });
    await page.goto('/bank-connections');
    let dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('transactions.csv')]);
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();
    await dialog.getByRole('button', {name: 'Cancel'}).click();

    await expect(
      dialog.getByRole('alert').getByText("Tempo doesn't know this file's layout yet"),
    ).toBeVisible();
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toContainText(
      'transactions.csv',
    );
    // Closing the dialog while working stops too; Import a file opens it where it was.
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();
    await expect(dialog.getByRole('status').getByText('Working out the columns…')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    dialog = await openImport(page);
    await expect(
      dialog.getByRole('alert').getByText("Tempo doesn't know this file's layout yet"),
    ).toBeVisible();
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toContainText(
      'transactions.csv',
    );
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();
    await dialog.getByRole('button', {name: 'Not right'}).click();

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("Tempo didn't import anything")).toBeVisible();
    await expect(alert).toContainText("This layout isn't supported yet.");
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toHaveCount(0);
    expect(api.rejects).toEqual([layoutProposal().id]);
    expect(api.confirms).toEqual([]);
    expect(api.uploads).toHaveLength(1);
  });

  test('says when a try at working out columns failed or found nothing, and when the limit allows another', async ({
    page,
  }) => {
    await mockFileImport(page, {
      mapper: true,
      uploads: [
        refused({code: 'layout_unknown', file: 1}),
        refused({code: 'layout_unknown', file: 1}),
      ],
      proposals: [
        (route) =>
          fulfillJson(
            route,
            {statusCode: 503, message: '', code: 'mapper_unavailable', file: 1},
            503,
          ),
        (route) =>
          fulfillJson(
            route,
            {statusCode: 422, message: '', code: 'layout_not_mappable', file: 1},
            422,
          ),
        (route) =>
          fulfillJson(
            route,
            {
              statusCode: 422,
              message: '',
              code: 'mapper_limit_reached',
              file: 1,
              retryAt: '2026-11-12T15:30:00.000Z',
            },
            422,
          ),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    const input = dialog.getByTestId('bank-import-file-input');
    await input.setInputFiles([statement('transactions.csv')]);
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();

    // A failed try says so and keeps the file to try again.
    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("Working out the columns didn't work this time")).toBeVisible();
    await expect(alert).toContainText(
      'Try again later. Each try counts towards the 5 allowed in 24 hours. Nothing was imported.',
    );
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toContainText(
      'transactions.csv',
    );
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();

    await expect(alert.getByText("Tempo couldn't work out this file's columns")).toBeVisible();
    await expect(alert).toContainText(
      'Nothing was imported. Try another export format from your bank, such as CAMT.053 or MT940.',
    );
    await expect(dialog.getByRole('button', {name: 'Work out the columns'})).toHaveCount(0);

    await input.setInputFiles([statement('transactions.csv')]);
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();
    await expect(alert.getByText("You've reached the limit of 5 tries in 24 hours")).toBeVisible();
    await expect(alert).toContainText(
      /Every try at working out columns counts, even one that failed or was cancelled\. You can try again today at (16:30|4:30\sPM)\. Nothing was imported\./,
    );
  });

  test('lists Your layouts in Supported files, and removes one in place', async ({page}) => {
    const api = await mockFileImport(page, {
      mapper: true,
      layouts: [
        {id: LAYOUT_ID, bankName: 'Example Bank', createdAt: TODAY.toISOString()},
        {
          id: '00000000-0000-4000-8000-000000000602',
          bankName: 'Example Savings Bank',
          createdAt: '2026-10-01T09:00:00.000Z',
        },
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog.getByRole('button', {name: 'Supported files'}).click();

    const supported = page.getByRole('dialog', {name: 'Supported files'});
    const yours = supported.getByRole('list', {name: 'Your layouts'}).getByRole('listitem');
    await expect(yours).toHaveText([
      /^Example Bank\s*Added today\s*Remove$/,
      /^Example Savings Bank\s*Added 1 Oct\s*Remove$/,
    ]);
    await supported.getByRole('button', {name: 'Remove Example Bank'}).click();

    await expect(yours).toHaveText([/^Example Savings Bank/]);
    expect(api.removed).toEqual([LAYOUT_ID]);
  });

  test('refuses files too large together before uploading them, with the copy the API would answer', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {uploads: [created(importSummary({filesCount: 1}))]});
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    // Three files under 10 MB each, 27 MB together.
    await dialog.getByTestId('bank-import-file-input').setInputFiles(
      ['a', 'b', 'c'].map((name) => ({
        ...statement(`statement-${name}.xml`),
        buffer: Buffer.alloc(9 * 1024 * 1024, 0x20),
      })),
    );

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText('These files are too large together')).toBeVisible();
    await expect(alert).toContainText('Import them in smaller batches. Nothing was imported.');
    expect(api.uploads).toHaveLength(0);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-a.xml')]);
    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    expect(api.uploads).toHaveLength(1);
  });

  test('asks which account a statement is, then sends the same files with the answer', async ({
    page,
  }) => {
    const savings = MOCK_CONNECTION.bankAccounts[1];
    // Two accounts at one bank under the holder's name, told apart as the Connections page tells them apart.
    const atExampleBank = {
      name: 'Example Holder',
      details: null,
      currency: 'EUR',
      bankName: 'Example Bank',
      imported: false,
    };
    const logo =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#808080"/></svg>',
      );
    await page.route(`${API_URL}/bank-connections/aspsps`, (route) =>
      fulfillJson(route, [
        {name: MOCK_CONNECTION.aspspName, country: MOCK_CONNECTION.aspspCountry, logoUrl: logo},
      ]),
    );
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
                  ...atExampleBank,
                  bankAccountId: CHECKING.id,
                  alias: null,
                  cashAccountType: 'CACC',
                  maskedIdentifier: 'NL** **** **** 4300',
                },
                {
                  ...atExampleBank,
                  bankAccountId: savings.id,
                  alias: 'Rainy day',
                  cashAccountType: 'SVGS',
                  maskedIdentifier: 'NL** **** **** 1234',
                },
                {
                  bankAccountId: FILE_ACCOUNT_ID,
                  name: 'Example Bank EUR',
                  details: null,
                  alias: null,
                  cashAccountType: null,
                  maskedIdentifier: null,
                  currency: 'EUR',
                  bankName: 'Imported files',
                  imported: true,
                },
              ],
              // The imported-files account of this bank and currency exists: it is offered as itself.
              newAccount: false,
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
      question.getByText(
        'Few of these transactions match what Tempo already has for Example Holder.',
      ),
    ).toBeVisible();
    const radios = question.getByRole('radio');
    await expect(radios).toHaveCount(3);
    for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
    await expect(radios.nth(0)).toHaveAccessibleName(
      /^Example Holder\s*Current account · ••4300 · Example Bank$/,
    );
    await expect(radios.nth(1)).toHaveAccessibleName(
      /^Rainy day\s*Savings · ••1234 · Example Bank$/,
    );
    await expect(radios.nth(2)).toHaveAccessibleName(/^Example Bank EUR\s*Imported files$/);
    // Each starts with its bank's logo as on its Connections card (imported files: the files tile), and its type
    // as on its Connections row.
    const tiles = question.getByTestId('bank-import-account-tile');
    await expect(tiles).toHaveCount(3);
    for (const index of [0, 1])
      await expect(tiles.nth(index).getByTestId('bank-logo').locator('img')).toHaveAttribute(
        'src',
        logo,
      );
    await expect(tiles.nth(2).getByTestId('bank-logo')).toHaveCount(0);
    await expect(tiles.nth(2).locator('svg.lucide-files')).toBeVisible();
    for (const [index, type] of ['wallet', 'piggy-bank', 'landmark'].entries())
      await expect(tiles.nth(index).locator(`svg.lucide-${type}`)).toBeVisible();
    const importButton = dialog.getByRole('button', {name: 'Import', exact: true});
    await expect(importButton).toBeDisabled();

    // Arrow keys move between the choices.
    await radios.first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(question.getByRole('radio', {name: /Rainy day/})).toBeChecked();
    await question.getByText('Example Holder', {exact: true}).click();
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
              details: null,
              alias: null,
              cashAccountType: null,
              maskedIdentifier: null,
              currency: 'EUR',
              bankName: 'Example Bank',
              imported: false,
            },
          ],
          newAccount: true,
        },
        {bank: 'Example Bank', currency: 'USD', candidates: [], newAccount: true},
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
    // A new account starts with its own tile, in line with the accounts above it.
    const eur = dialog.getByRole('group', {name: 'Example Bank · EUR'});
    const tiles = eur.getByTestId('bank-import-account-tile');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(1).locator('svg.lucide-plus')).toBeVisible();
    const [accountTile, newTile] = await Promise.all([boxOf(tiles.nth(0)), boxOf(tiles.nth(1))]);
    expect(newTile.x).toBe(accountTile.x);
    expect(newTile.width).toBe(accountTile.width);
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

  test('reviews doubtful rows in place, changes a choice, saves both answers and returns to the summary', async ({
    page,
  }) => {
    const summary = importSummary({rowsDoubtful: 2});
    const rows: BankImportDoubtfulRow[] = [
      doubtfulRow('00000000-0000-4000-8000-000000000601', 'Example Grocer', '-23.40', [
        candidate('00000000-0000-4000-8000-000000000701', 'Example Grocer', '-23.40'),
        candidate(
          '00000000-0000-4000-8000-000000000702',
          'Example Grocer Outlet',
          '-23.40',
          '2026-10-03',
        ),
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
    // Each stored row says how its day sits against the file row's.
    await expect(first.getByText('1 Oct · same day')).toBeVisible();
    await expect(first.getByText('3 Oct · 2 days later')).toBeVisible();
    // One choice per row, nothing chosen yet, and nothing to save.
    const firstChoices = first.getByRole('radio');
    await expect(firstChoices).toHaveCount(3);
    for (const choice of await firstChoices.all()) await expect(choice).not.toBeChecked();
    await expect(firstChoices.nth(2)).toHaveAccessibleName("It's a new transaction");
    const save = dialog.getByRole('button', {name: /^Save/});
    await expect(save).toBeDisabled();

    // Choices change freely before they are saved: arrow keys move between them, a click picks another.
    const outlet = first.getByRole('radio', {name: 'Same as Example Grocer Outlet on 3 Oct'});
    await first.getByText("It's a new transaction").click();
    await expect(firstChoices.nth(2)).toBeChecked();
    await firstChoices.nth(2).press('ArrowUp');
    await expect(outlet).toBeChecked();
    await expect(firstChoices.nth(2)).not.toBeChecked();
    await expect(save).toHaveText('Save answer');
    await second.getByText("It's a new transaction").click();
    await expect(save).toHaveText('Save 2 answers');
    expect(api.resolves).toEqual([]);

    // The file row's amount and every choice's amount share one right edge.
    const amounts = first.locator('.numeric');
    await expect(amounts).toHaveCount(3);
    const rights = await Promise.all(
      (await amounts.all()).map(async (amount) => {
        const box = await boxOf(amount);
        return Math.round(box.x + box.width);
      }),
    );
    expect(new Set(rights).size).toBe(1);

    // Saving every answer returns to the summary, with its counts.
    await save.click();
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

  test('keeps a doubtful row whose answer failed open with its choice, and saves only the rows with one', async ({
    page,
  }) => {
    const summary = importSummary({rowsDoubtful: 4});
    const rows: BankImportDoubtfulRow[] = [
      doubtfulRow('00000000-0000-4000-8000-000000000611', 'Example Grocer', '-23.40', [
        candidate('00000000-0000-4000-8000-000000000711', 'Example Grocer', '-23.40'),
      ]),
      doubtfulRow('00000000-0000-4000-8000-000000000612', 'Example Refund', '12.00', []),
      doubtfulRow('00000000-0000-4000-8000-000000000613', 'Example Bakery', '-3.10', [
        candidate('00000000-0000-4000-8000-000000000713', 'Example Bakery', '-3.10'),
      ]),
      doubtfulRow('00000000-0000-4000-8000-000000000614', 'Example Florist', '-18.00', [
        candidate('00000000-0000-4000-8000-000000000714', 'Example Florist', '-18.00'),
      ]),
    ];
    const api = await mockFileImport(page, {imports: [summary], doubtfulRows: rows});
    let failRefund = true;
    await page.route(
      `${API_URL}/bank-imports/*/doubtful-rows/00000000-0000-4000-8000-000000000612/resolve`,
      (route) => {
        if (!failRefund) return route.fallback();
        failRefund = false;
        return fulfillJson(route, {statusCode: 500, message: 'Internal server error'}, 500);
      },
    );
    await page.goto('/bank-connections');
    await page
      .getByTestId('bank-import-row')
      .getByRole('button', {name: '3 files · 212 new'})
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', {name: 'Review 4 rows'}).click();
    const blocks = dialog.getByTestId('bank-import-doubtful-row');
    const [grocer, refund, bakery, florist] = [0, 1, 2, 3].map((index) => blocks.nth(index));
    // A row with nothing to compare offers the new transaction alone.
    await expect(refund).toContainText('Nothing already in Tempo matches it now');
    await expect(refund.getByRole('radio')).toHaveCount(1);

    await grocer.getByText('Example Grocer', {exact: true}).last().click();
    await refund.getByText("It's a new transaction").click();
    await bakery.getByText("It's a new transaction").click();
    await expect(dialog.getByText('1 without an answer stays open')).toBeVisible();
    await dialog.getByRole('button', {name: 'Save 3 answers'}).click();

    await expect(grocer.getByRole('status')).toHaveText(
      'Marked as the same as Example Grocer on 1 Oct',
    );
    await expect(grocer.getByRole('radio')).toHaveCount(0);
    // A failure does not stop the rows after it.
    await expect(bakery.getByRole('status')).toHaveText('Kept as new');
    await expect(refund.getByRole('alert')).toHaveText(
      "Couldn't save this answer. Save to try again.",
    );
    await expect(refund.getByRole('radio', {name: "It's a new transaction"})).toBeChecked();
    await expect(page.locator('[data-sonner-toast]')).toContainText("Couldn't save your answer");
    for (const choice of await florist.getByRole('radio').all())
      await expect(choice).not.toBeChecked();
    await expect(dialog.getByRole('heading', {name: 'Check 4 transactions'})).toBeVisible();

    // Trying again sends the failed answer alone; the row without a choice stays open.
    await dialog.getByRole('button', {name: 'Save answer'}).click();
    await expect(refund.getByRole('status')).toHaveText('Kept as new');
    await expect(florist.getByRole('radio')).toHaveCount(2);
    await expect(dialog.getByRole('button', {name: 'Save answer'})).toBeDisabled();
    expect(api.resolves).toEqual([
      {decision: 'duplicate', transactionId: '00000000-0000-4000-8000-000000000711'},
      {decision: 'new'},
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
    await expect(page.getByText('Import undone')).toBeVisible();
    await expect(confirm).toBeHidden();
    expect(api.undos).toEqual(['00000000-0000-4000-8000-000000000511']);
    await expect(rows.first()).toContainText('Undone 12 Nov');
    await expect(rows.first().getByRole('button', {name: '3 files', exact: true})).toBeVisible();
    await expect(rows.first().getByRole('button', {name: /^Undo/})).toHaveCount(0);
  });

  test('asks for the balance today of an imported-files account that has none, and saves it in place', async ({
    page,
  }) => {
    const newAccount = {
      ...IMPORTED_FILES.bankAccounts[0],
      currentBalanceAmount: null,
      balanceUpdatedAt: null,
      balanceSource: null,
    };
    let connections: BankConnection[] = [MOCK_CONNECTION];
    await mockBankConnections(page, () => connections);
    const summary = importSummary({
      filesCount: 1,
      rowsDoubtful: 0,
      accounts: [
        {id: FILE_ACCOUNT_ID, name: 'NL91 ABNA 0417 1643 00', currency: 'EUR', created: true},
      ],
      accountsWithoutBalance: [
        {id: FILE_ACCOUNT_ID, name: 'NL91 ABNA 0417 1643 00', currency: 'EUR'},
      ],
    });
    const api = await mockFileImport(page, {
      uploads: [
        async (route, api) => {
          // The import creates the account, so the connection list holds it only from now on.
          connections = [{...IMPORTED_FILES, bankAccounts: [newAccount]}, MOCK_CONNECTION];
          await created(summary)(route, api);
        },
      ],
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const amounts = await mockSetBalance(
      page,
      (account) => {
        connections = [{...IMPORTED_FILES, bankAccounts: [account]}, MOCK_CONNECTION];
        api.imports = api.imports.map((existing) => ({...existing, accountsWithoutBalance: []}));
      },
      held,
    );
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.xml')]);

    const prompt = dialog.getByTestId('bank-import-balances');
    const field = prompt.getByLabel('Balance of Example Card · EUR today');
    await expect(field).toBeVisible();
    await expect(
      prompt.getByText('Tempo works out earlier balances from your transactions.'),
    ).toBeVisible();
    await expectCurrencyInside(field, 'EUR');
    // Inline in the summary, not a dialog on top of it.
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await field.fill('1250.405');
    await prompt.getByRole('button', {name: 'Save'}).click();
    await expect(prompt.getByRole('alert')).toContainText('Enter an amount');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(amounts).toEqual([]);

    await field.fill('1250,40');
    await expect(prompt.getByRole('alert')).toHaveCount(0);
    await prompt.getByRole('button', {name: 'Save'}).click();
    await expect(prompt.getByRole('button', {name: 'Saving…'})).toBeDisabled();
    release();

    await expect(prompt.getByRole('status')).toContainText('€1,250.40');
    await expect(prompt.getByRole('status')).toContainText('Saved');
    await expect(field).toHaveCount(0);
    expect(amounts).toEqual(['1250.40']);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await dialog.getByRole('button', {name: 'Done'}).click();
    await expect(dialog).toBeHidden();
    const card = page.getByRole('region', {name: 'Imported files'});
    await expect(card).toContainText('€1,250.40');
    await expect(
      card.getByRole('button', {name: 'Edit balance of Example Card · EUR'}),
    ).toBeVisible();
  });

  test('closes the summary without a balance, and a refused save says why', async ({page}) => {
    await mockBankConnections(page, [
      {
        ...IMPORTED_FILES,
        bankAccounts: [
          {...IMPORTED_FILES.bankAccounts[0], currentBalanceAmount: null, balanceSource: null},
        ],
      },
      MOCK_CONNECTION,
    ]);
    const summary = importSummary({
      filesCount: 1,
      rowsDoubtful: 0,
      accounts: [{id: FILE_ACCOUNT_ID, name: null, currency: 'EUR', created: false}],
      accountsWithoutBalance: [{id: FILE_ACCOUNT_ID, name: null, currency: 'EUR'}],
    });
    await mockFileImport(page, {imports: [summary], uploads: [created(summary)]});
    await page.route(`${API_URL}/bank-connections/*/accounts/*/balance`, (route) =>
      fulfillJson(route, {statusCode: 409, message: 'Refused.', code: 'balance_from_bank'}, 409),
    );
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement('statement.xml')]);
    const prompt = dialog.getByTestId('bank-import-balances');
    await prompt.getByLabel('Balance of Example Card · EUR today').fill('-40.5');
    await prompt.getByRole('button', {name: 'Save'}).click();

    await expect(page.locator('[data-sonner-toast]')).toContainText(
      "This account's balance comes from its bank",
    );
    await expect(prompt.getByRole('button', {name: 'Save'})).toBeEnabled();
    await dialog.getByRole('button', {name: 'Done'}).click();
    await expect(dialog).toBeHidden();
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
    await page.goto('/bank-connections');
    const card = page.getByRole('region', {name: 'Imported files'});
    const rowOf = (name: string) =>
      card
        .getByRole('listitem')
        .filter({has: page.getByRole('link', {name: `${name} transactions`})});

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
    // Stated by its statements: the amount only.
    await expect(rowOf('Example Statement')).toContainText('€310.00');
    await expect(rowOf('Example Statement').getByRole('button')).toHaveCount(0);
    // The rest of a row with an action still opens its transactions.
    await expect(card.getByRole('link', {name: 'Example Wallet transactions'})).toHaveAttribute(
      'href',
      new RegExp(`bankAccountIds=.*${FILE_ACCOUNT_ID}`),
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
      dialog.getByText('Tempo works out earlier balances from your transactions.'),
    ).toBeVisible();
    const field = dialog.getByLabel('Balance of Example Wallet today');
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

  test("imports files dropped on the dialog's drop area", async ({page}) => {
    const api = await mockFileImport(page, {uploads: [created(importSummary({filesCount: 1}))]});
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    const area = dialog.getByTestId('bank-import-drop-area');

    // The browser lets a drop through only when the drag's last answer allows it. A drag event made in a test
    // ignores what handlers set, so record the answers.
    const answers = await area.evaluate((target) => {
      const data = new DataTransfer();
      data.items.add(new File(['synthetic'], 'dropped-statement.xml'));
      const written: string[] = [];
      Object.defineProperty(data, 'dropEffect', {
        set: (value: string) => written.push(value),
        get: () => written[written.length - 1] ?? 'none',
      });
      const init = {bubbles: true, cancelable: true, dataTransfer: data};
      target.dispatchEvent(new DragEvent('dragenter', init));
      target.dispatchEvent(new DragEvent('dragover', init));
      return written;
    });
    expect(answers[answers.length - 1]).toBe('copy');

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['synthetic'], 'dropped-statement.xml'));
      return data;
    });
    await area.dispatchEvent('drop', {dataTransfer: transfer});
    await expect(dialog.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
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

  test('a busy import keeps the chosen files for another try, and a proxy size refusal reads as too large together', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {
      uploads: [
        refused({code: 'import_busy', statusCode: 503}),
        // The proxy in front of the API answers with its own page, not a typed refusal.
        (route) => route.fulfill({status: 413, contentType: 'text/html', body: '<html>413</html>'}),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-a.xml'), statement('statement-b.xml')]);

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText('Other files are being imported')).toBeVisible();
    await expect(alert).toContainText('Try again in a minute. Nothing was imported.');
    await expect(
      dialog.getByRole('list', {name: 'Chosen files'}).getByRole('listitem'),
    ).toHaveCount(2);

    await dialog.getByRole('button', {name: 'Import', exact: true}).click();
    await expect(alert.getByText('These files are too large together')).toBeVisible();
    await expect(alert).toContainText('Import them in smaller batches. Nothing was imported.');
    await expect(dialog.getByRole('list', {name: 'Chosen files'})).toHaveCount(0);
    expect(api.uploads).toHaveLength(2);
  });

  test('a server failure says so at the end of the dialog, and Try again sends the same files', async ({
    page,
  }) => {
    const api = await mockFileImport(page, {
      uploads: [
        (route) => fulfillJson(route, {statusCode: 500, message: 'Internal server error'}, 500),
        created(importSummary({filesCount: 2})),
      ],
    });
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog
      .getByTestId('bank-import-file-input')
      .setInputFiles([statement('statement-a.xml'), statement('statement-b.xml')]);

    const alert = dialog.getByRole('alert');
    await expect(alert.getByText("Couldn't import these files")).toBeVisible();
    await expect(alert).toContainText('The server ran into a problem.');
    await expect(alert).toContainText(/500 · \d{2}:\d{2}/);
    const supportedFiles = dialog.getByRole('button', {name: 'Supported files'});
    expect((await boxOf(alert)).y).toBeGreaterThanOrEqual(
      (await boxOf(supportedFiles)).y + (await boxOf(supportedFiles)).height,
    );

    await alert.getByRole('button', {name: 'Try again'}).click();
    await expect(dialog.getByRole('heading', {name: 'Imported 2 files'})).toBeVisible();
    expect(api.uploads.map((upload) => sentForm(upload).files)).toEqual([
      ['statement-a.xml', 'statement-b.xml'],
      ['statement-a.xml', 'statement-b.xml'],
    ]);
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

  test('keeps the column preview and Your layouts inside 390px and 320px with long names and amounts', async ({
    page,
  }) => {
    const long = 'Example Household Shared Everyday Account Payment Reference 2026';
    const row = (amount: string) => ({
      date: '2026-03-02',
      amount,
      currency: 'EUR',
      counterparty: long,
      description: long,
      balanceAfter: null,
    });
    const proposal = layoutProposal({
      bankName: 'Example Bank With A Long Name For Statements Exported 2026'.slice(0, 60),
      currencyNeeded: true,
      dateCheck: {written: '03/04/2026', date: '2026-04-03'},
      mapping: {
        ...layoutProposal().mapping,
        columns: layoutProposal().mapping.columns.map((column) => ({...column, header: long})),
      },
      preview: {
        ...layoutProposal().preview,
        rowCount: 1_234_567,
        firstRows: Array.from({length: 5}, () => row('-1234567.89')),
        lastRows: [row('1234567.89'), row('-1234567.89')],
        totals: [{currency: 'EUR', moneyIn: '987654321.00', moneyOut: '987654321.00'}],
        accounts: ['DE89370400440532013000', 'GB82WEST12345698765432'],
      },
    });
    await mockFileImport(page, {
      mapper: true,
      uploads: [refused({code: 'layout_unknown', file: 1})],
      proposals: [proposed(proposal)],
      layouts: [{id: LAYOUT_ID, bankName: proposal.bankName!, createdAt: TODAY.toISOString()}],
    });
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/bank-connections');
    const dialog = await openImport(page);
    await dialog.getByTestId('bank-import-file-input').setInputFiles([statement(`${long}.csv`)]);
    await dialog.getByRole('button', {name: 'Work out the columns'}).click();
    await expect(dialog.getByTestId('bank-import-date-check')).toBeVisible();

    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 700});
      await expectNoHorizontalOverflow(page);
      const confirm = dialog.getByRole('button', {name: 'Looks right'});
      await expect(confirm).toBeInViewport();
      expect((await boxOf(confirm)).height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole('button', {name: 'Not right'}).click();
    await dialog.getByRole('button', {name: 'Supported files'}).click();
    const supported = page.getByTestId('supported-files');
    await expect(supported.getByRole('list', {name: 'Your layouts'})).toBeVisible();
    const remove = supported.getByRole('button', {name: `Remove ${proposal.bankName}`});
    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 700});
      await expectNoHorizontalOverflow(page);
      const [sheet, name, button] = await Promise.all([
        boxOf(supported),
        boxOf(supported.getByText(proposal.bankName!, {exact: true})),
        boxOf(remove),
      ]);
      expect(name.x + name.width).toBeLessThanOrEqual(button.x);
      expect(button.x + button.width).toBeLessThanOrEqual(sheet.x + sheet.width);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
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
        accountsWithoutBalance: [{id: FILE_ACCOUNT_ID, name: null, currency: 'EUR'}],
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
          bankAccounts: [
            {
              ...IMPORTED_FILES.bankAccounts[0],
              alias: LONG_ACCOUNT,
              currentBalanceAmount: null,
              balanceSource: null,
            },
          ],
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
      const balance = dialog.getByLabel(`Balance of ${LONG_ACCOUNT} today`);
      await expect(balance).toBeVisible();
      // A long amount scrolls inside the field and leaves its currency in view.
      await balance.fill('-123456789012345678901234567890.55');
      await expectCurrencyInside(balance, 'EUR');
      expect(await balance.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await expectNothingWiderThan(dialog);
      const review = dialog.getByRole('button', {name: 'Review 40 rows'});
      await expectInsideViewport(page, review);
      await review.click();
      await expect(dialog.getByRole('heading', {name: 'Check 40 transactions'})).toBeVisible();
      await expect(dialog.getByTestId('bank-import-doubtful-row')).toHaveCount(40);
      // On phones the file row's amount and its choice's amount still share one right edge.
      const block = dialog.getByTestId('bank-import-doubtful-row').first();
      const [fileAmount, candidateAmount] = await Promise.all([
        boxOf(block.locator('.numeric').first()),
        boxOf(block.locator('.numeric').last()),
      ]);
      expect(
        Math.abs(fileAmount.x + fileAmount.width - candidateAmount.x - candidateAmount.width),
      ).toBeLessThan(1);
      await expectNothingWiderThan(dialog);
      // Save stays in reach while the body scrolls inside the sheet to the last row.
      const save = dialog.getByRole('button', {name: /^Save/});
      await expectInsideViewport(page, save);
      const last = dialog.getByText("It's a new transaction").last();
      await last.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, last);
      await last.click();
      await expect(save).toHaveText('Save answer');
      await expectInsideViewport(page, save);
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

function candidate(id: string, description: string, amount: string, date = '2026-10-01') {
  return {
    id,
    transactionDate: date,
    bookingDate: date,
    valueDate: date,
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
