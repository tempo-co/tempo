import {type Locator, type Page, type Request, type Route, expect} from '@playwright/test';
import type {
  AddBankImportNeverSentRowsRequest,
  BankConnection,
  BankImportBanks,
  BankImportDoubtfulRow,
  BankImportError,
  BankImportLayout,
  BankImportNeverSentRow,
  BankImportPreview,
  BankImportSummary,
  ConfirmBankImportLayoutProposalRequest,
  ResolveBankImportDoubtfulRowRequest,
  SetBankAccountBalanceRequest,
} from '@wisp/contracts';

import {MOCK_CONNECTION} from '../data/bank-connection.data';
import {API_URL} from '../fixtures';
import {fulfillJson} from './api-mocks';
import {boxOf} from './layout';

export const TODAY = new Date('2026-11-12T10:00:00+01:00');
export const CHECKING = MOCK_CONNECTION.bankAccounts[0];
export const FILE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000401';

export const LAYOUT_ID = '00000000-0000-4000-8000-000000000601';
/** The owner's own banks to pick a layout's bank from, as the API sorts them. */
export const KNOWN_BANKS = ['ABN AMRO', 'Example Bank', 'ING'];
export const RESERVED_BANK_NAME =
  "Revolut's own exports already import into your Revolut accounts. Name this bank differently.";

export const statement = (name: string) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(`synthetic statement ${name}`),
});

export function importSummary(fields: Partial<BankImportSummary> = {}): BankImportSummary {
  return {
    id: '00000000-0000-4000-8000-000000000501',
    bankId: null,
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
    rowsNotInBank: 0,
    rowsRemovedBySync: 0,
    dateFrom: '2026-05-01',
    dateTo: '2026-10-30',
    accounts: [{id: CHECKING.id, name: 'Holder Name', currency: 'EUR', created: false}],
    accountsWithoutBalance: [],
    statementGaps: [],
    undoneAt: null,
    createdAt: '2026-11-12T09:30:00.000Z',
    ...fields,
  };
}

export const IMPORTED_FILES: BankConnection = {
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

export type ImportApi = {
  imports: BankImportSummary[];
  /** The drops imported (`POST /bank-imports`). */
  uploads: Request[];
  /** The drops read for Check what we found (`POST /bank-imports/preview`), refused ones included. */
  previews: Request[];
  resolves: ResolveBankImportDoubtfulRowRequest[];
  /** The bodies of never-sent rows added, and how often the list of them was read. */
  adds: AddBankImportNeverSentRowsRequest[];
  neverSentReads: number;
  /** The never-sent rows added, which the list of them no longer holds. */
  added: Set<string>;
  undos: string[];
  proposals: Request[];
  confirms: ConfirmBankImportLayoutProposalRequest[];
  /** How often a proposal's list of banks was read. */
  banksReads: number;
  rejects: string[];
  layouts: BankImportLayout[];
  removed: string[];
};

/** An answer to a drop: what the import replies, and what its preview replies before it. */
export type UploadAnswer = ((route: Route, api: ImportApi) => Promise<void>) & {
  /** A refusal answers the preview, and the drop is never imported. */
  refusal?: true;
  /** The summary the import replies with, which the preview describes. */
  summary?: BankImportSummary;
};

/**
 * What the preview of a drop the import answers with `summary` says: its accounts, the ones the import created as new,
 * with the summary's rows and days.
 */
export function previewOf(summary: BankImportSummary = importSummary()): BankImportPreview {
  const count = summary.accounts.length;
  return {
    rowCount: summary.rowsParsed,
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
    accounts: summary.accounts.map((account, index) => {
      // A found account as Accounts lists it, when it is one of the mocked ones.
      const stored = account.created
        ? undefined
        : [...MOCK_CONNECTION.bankAccounts, ...IMPORTED_FILES.bankAccounts].find(
            ({id}) => id === account.id,
          );
      const synced = !!stored && MOCK_CONNECTION.bankAccounts.includes(stored);
      return {
        id: account.created ? null : account.id,
        name: stored ? stored.name : account.name,
        alias: stored?.alias ?? null,
        details: stored?.details ?? null,
        cashAccountType: stored?.cashAccountType ?? null,
        maskedIdentifier: stored?.maskedIdentifier ?? null,
        currency: account.currency,
        bankName: synced ? MOCK_CONNECTION.aspspName : null,
        imported: !synced,
        // The rows spread over the accounts, the first taking any left over.
        rowCount:
          Math.floor(summary.rowsParsed / count) + (index === 0 ? summary.rowsParsed % count : 0),
        dateFrom: summary.dateFrom,
        dateTo: summary.dateTo,
      };
    }),
  };
}

/**
 * File import on: the import list, then `answer` for each drop in turn. Each drop is read first (its preview): a
 * refusal answers there and takes its turn; any other answer lets the preview through, described by its summary when
 * it has one, and answers the import that follows. Doubtful rows and their answers, and undo, keep the list in step
 * like the API does.
 */
export async function mockFileImport(
  page: Page,
  {
    imports = [],
    uploads = [],
    doubtfulRows = [],
    neverSentRows = [],
    holdAdd,
    failAdds = {},
    mapper = false,
    proposals = [],
    layouts = [],
    banks = KNOWN_BANKS,
    banksFailures = 0,
  }: {
    imports?: BankImportSummary[];
    uploads?: UploadAnswer[];
    doubtfulRows?: BankImportDoubtfulRow[];
    neverSentRows?: BankImportNeverSentRow[];
    /** Holds each add of never-sent rows until it resolves. */
    holdAdd?: () => Promise<void>;
    /** The status each add of never-sent rows that fails answers with, by the add's index from 0. */
    failAdds?: Record<number, number>;
    /** Whether the deployment works out the columns of a table it does not know. */
    mapper?: boolean;
    /** The answer to each proposal in turn. */
    proposals?: ((route: Route) => Promise<void>)[];
    layouts?: BankImportLayout[];
    /** The banks `GET /bank-imports/layout-proposals/:proposalId/banks` lists. */
    banks?: string[];
    /** How many reads of the banks fail first (429, which the query does not retry). */
    banksFailures?: number;
  } = {},
) {
  const api: ImportApi = {
    added: new Set(),
    imports: [...imports],
    uploads: [],
    previews: [],
    resolves: [],
    adds: [],
    neverSentReads: 0,
    undos: [],
    proposals: [],
    confirms: [],
    banksReads: 0,
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
  await page.route(`${API_URL}/bank-imports/preview`, async (route) => {
    api.previews.push(route.request());
    const answer = uploads[0];
    if (!answer) throw new Error('Unexpected preview');
    if (!answer.refusal) return fulfillJson(route, previewOf(answer.summary));
    uploads.shift();
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
  await page.route(`${API_URL}/bank-imports/*/never-sent-rows`, (route) => {
    api.neverSentReads += 1;
    // Like the API, the list holds only the rows not added yet.
    return fulfillJson(
      route,
      neverSentRows.filter(({id}) => !api.added.has(id)),
    );
  });
  await page.route(`${API_URL}/bank-imports/*/never-sent-rows/add`, async (route) => {
    const request = route.request().postDataJSON() as AddBankImportNeverSentRowsRequest;
    api.adds.push(request);
    await holdAdd?.();
    const failure = failAdds[api.adds.length - 1];
    if (failure) return fulfillJson(route, {statusCode: failure, message: 'Refused'}, failure);
    for (const id of request.rowIds) api.added.add(id);
    const [current] = api.imports;
    const removed = request.rowIds.filter(
      (id) => neverSentRows.find((row) => row.id === id)?.kind === 'removed_by_sync',
    ).length;
    const next = {
      ...current,
      rowsAdded: current.rowsAdded + request.rowIds.length,
      rowsNotInBank: current.rowsNotInBank - (request.rowIds.length - removed),
      rowsRemovedBySync: current.rowsRemovedBySync - removed,
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
  // The API answers a confirmed proposal's list of banks with a conflict.
  const confirmed = new Set<string>();
  const proposalOf = (route: Route) =>
    new URL(route.request().url()).pathname.split('/').slice(-2)[0];
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
    confirmed.add(proposalOf(route));
    return fulfillJson(route, layout, 201);
  });
  await page.route(`${API_URL}/bank-imports/layout-proposals/*/reject`, (route) => {
    const segments = new URL(route.request().url()).pathname.split('/');
    api.rejects.push(segments[segments.length - 2]);
    return route.fulfill({status: 204});
  });
  await page.route(`${API_URL}/bank-imports/layouts`, (route) => fulfillJson(route, api.layouts));
  let banksFailed = 0;
  await page.route(`${API_URL}/bank-imports/layout-proposals/*/banks`, (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    api.banksReads += 1;
    if (confirmed.has(proposalOf(route)))
      return fulfillJson(route, {statusCode: 409, message: 'Conflict'}, 409);
    if (banksFailed < banksFailures) {
      banksFailed += 1;
      return fulfillJson(route, {statusCode: 429, message: 'Too Many Requests'}, 429);
    }
    return fulfillJson(route, {banks} satisfies BankImportBanks);
  });
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
export async function mockSetBalance(
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
export const created = (summary: BankImportSummary): UploadAnswer =>
  Object.assign(
    (route: Route, api: ImportApi) => {
      api.imports = [summary, ...api.imports.filter(({id}) => id !== summary.id)];
      return fulfillJson(route, summary, 201);
    },
    {summary},
  );
/** A drop the API refused, as its preview already does. */
export const refused = (
  error: Partial<BankImportError> & Pick<BankImportError, 'code'>,
): ((route: Route) => Promise<void>) & {refusal: true} =>
  Object.assign(
    (route: Route) =>
      fulfillJson(
        route,
        {statusCode: 422, message: 'Refused.', file: null, ...error},
        error.statusCode ?? 422,
      ),
    {refusal: true as const},
  );

/** Check what we found: its one Import, named for the drop's rows. */
export async function importFound(dialog: Locator) {
  await expect(dialog.getByRole('heading', {name: 'Check what we found'})).toBeVisible();
  await dialog.getByRole('button', {name: /^Import [\d,]+ transactions?$/}).click();
}

/**
 * A balance field shows its currency inside, at the far right, over the padding its value scrolls short of; and
 * names it in its description.
 */
export async function expectCurrencyInside(field: Locator, currency: string) {
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

/** The multipart form an upload sent: its file names in order and its text fields. */
export function sentForm(request: Request) {
  const body = request.postDataBuffer()?.toString('latin1') ?? '';
  const files = [...body.matchAll(/name="files"; filename="([^"]*)"/g)].map((match) => match[1]);
  const fields = Object.fromEntries(
    [...body.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)].map((match) => [match[1], match[2]]),
  );
  return {files, fields};
}

/** The bank picker's Another bank: the import's file choice, under the steps for any bank. */
export async function pickAnotherBank(sheet: Locator) {
  await expect(sheet.getByRole('heading', {name: 'Which bank is the file from?'})).toBeVisible();
  await sheet.getByRole('button', {name: /^Another bank/}).click();
  await expect(sheet.getByRole('heading', {name: 'Import a file'})).toBeVisible();
}

/** Add data in the sidebar, Import a statement file, then Another bank: the file choice, on any page. */
export async function openImportFromAddData(page: Page) {
  await page.getByTestId('app-sidebar').getByRole('button', {name: 'Add data'}).click();
  const sheet = page.getByTestId('add-data-sheet');
  await sheet.getByRole('button', {name: /^Import a statement file/}).click();
  await pickAnotherBank(sheet);
  return sheet;
}

/** Accounts' Import a file, then Another bank: the file choice. */
export async function openImport(page: Page) {
  await page.getByRole('button', {name: 'Import a file'}).first().click();
  const dialog = page.getByRole('dialog');
  await pickAnotherBank(dialog);
  return dialog;
}

/** Polled: a phone sheet slides in, so its controls settle into place after it opens. */
export async function expectInsideViewport(page: Page, locator: ReturnType<Page['locator']>) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await boxOf(locator);
      return box.y >= 0 && box.y + box.height <= viewport.height;
    })
    .toBe(true);
}
