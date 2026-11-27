import type {Locator, Page, Request} from '@playwright/test';
import type {BankConnection, BankTransactionReviewCounts} from '@tempo/contracts';

import {createAccount} from '../../data/account.data';
import {HOME_CONNECTION, mockSyntheticHome, monthTransactions} from '../../data/home-history.data';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {sentForm} from '../../utils/file-import';
import {animationsSettled, boxOf} from '../../utils/layout';

/** A synthetic CAMT.053 statement for a published example IBAN: three booked payments in March 2026. */
const STATEMENT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>',
  '<GrpHdr><MsgId>EXAMPLE</MsgId><CreDtTm>2026-03-11T00:00:00</CreDtTm></GrpHdr>',
  '<Stmt><Id>EXAMPLE-STMT</Id><Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id><Ccy>EUR</Ccy>',
  '<Svcr><FinInstnId><BIC>ABNANL2A</BIC></FinInstnId></Svcr></Acct>',
  ...[
    ['12.50', 'DBIT', '2026-03-02', 'Example Shop'],
    ['2500.00', 'CRDT', '2026-03-04', 'Example Employer'],
    ['4.20', 'DBIT', '2026-03-10', 'Example Cafe'],
  ].map(
    ([amount, indicator, day, info]) =>
      `<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${indicator}</CdtDbtInd><Sts>BOOK</Sts>` +
      `<BookgDt><Dt>${day}</Dt></BookgDt><ValDt><Dt>${day}</Dt></ValDt>` +
      `<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>CCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>` +
      `<AddtlNtryInf>${info}</AddtlNtryInf></Ntry>`,
  ),
  '</Stmt></BkToCstmrStmt></Document>',
].join('');
const FILE = {
  name: 'example-statement.xml',
  mimeType: 'application/xml',
  buffer: Buffer.from(STATEMENT),
};

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** Opens Home and waits for the import list, which says file import is on. */
async function openHome(page: Page) {
  const importList = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/bank-imports' && response.ok(),
  );
  await page.goto('/');
  await importList;
}

/** Drops `FILE` on `area`, as a file dragged in from the desktop. */
async function dropOn(page: Page, area: Locator) {
  const transfer = await page.evaluateHandle(
    ({name, content}) => {
      const data = new DataTransfer();
      data.items.add(new File([content], name));
      return data;
    },
    {name: FILE.name, content: STATEMENT},
  );
  await area.dispatchEvent('dragenter', {dataTransfer: transfer});
  await area.dispatchEvent('dragover', {dataTransfer: transfer});
  await area.dispatchEvent('drop', {dataTransfer: transfer});
}

/**
 * Holds each import of a drop until `release`, recording it; the preview before it goes straight through. Once a drop
 * is imported, the review counts hold its rows for checking, as categorizing does with rows it is unsure of: the E2E
 * stack runs without AI categorization, which would otherwise leave nothing to check.
 */
async function holdImports(page: Page) {
  const imports: Request[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${API_URL}/bank-imports`, async (route) => {
    if (route.request().method() === 'POST') {
      imports.push(route.request());
      await held;
    }
    await route.fallback();
  });
  await page.route(`${API_URL}/bank-transactions/review-counts`, async (route) => {
    const response = await route.fetch();
    const counts = (await response.json()) as BankTransactionReviewCounts;
    await route.fulfill({
      response,
      json: imports.length > 0 ? {...counts, needsReview: 3, needsAttention: 3} : counts,
    });
  });
  return {imports, release};
}

/** The picker's ABN AMRO, whose export steps follow. */
async function pickAbnAmro(sheet: Locator) {
  await expect(sheet.getByRole('heading', {name: 'Which bank is the file from?'})).toBeVisible();
  await sheet.getByRole('button', {name: /^ABN AMRO/}).click();
  await expect(sheet.getByRole('list', {name: 'How to get the file from ABN AMRO'})).toBeVisible();
}

/** Check what we found for the statement: its one new account, renamed, then Import. */
async function checkAndImport(sheet: Locator) {
  await expect(sheet.getByRole('heading', {name: 'Check what we found'})).toBeVisible();
  await expect(sheet).toContainText(
    '3 transactions from 2 Mar – 10 Mar 2026. Rename an account if you like.',
  );
  const found = sheet.getByTestId('bank-import-found-account');
  await expect(found).toHaveCount(1);
  await expect(found).toContainText('New');
  await expect(found).toContainText('EUR · 3 transactions · 2 Mar – 10 Mar 2026');
  const name = found.getByRole('textbox', {name: 'Name of account 1'});
  await expect(name).toHaveValue('NL91 ABNA 0417 1643 00');
  await name.fill('Example current account');
  await expect(sheet).toContainText('You can undo this import from Accounts.');
  await sheet.getByRole('button', {name: 'Import 3 transactions'}).click();
}

/** The filled Home: the toast, "Check N transactions" first in To do, and the account under its new name. */
async function expectFilledHome(page: Page) {
  await expect(page.getByText('Imported 1 file')).toBeVisible();
  const toDo = page.getByRole('main').getByRole('region', {name: 'To do', exact: true});
  await expect(toDo.getByRole('listitem').first()).toContainText(/^Check 3 transactions/);
  await expect(
    page.getByRole('main').getByRole('region', {name: 'Accounts', exact: true}),
  ).toContainText('Example current account');
}

test.describe('First run', () => {
  // The offline shell's worker would answer the sheet's chunk past page.route.
  test.use({timezoneId: 'Europe/Amsterdam', serviceWorkers: 'block'});

  test('a new account goes from the empty Home through its bank, a dropped file and Check what we found to a filled Home', async ({
    page,
    homePage,
    freshAccount,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    const {imports, release} = await holdImports(page);
    await openHome(page);

    // A greeting by first name, one Add data panel and Getting started with the steps that exist.
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      new RegExp(`^Good (morning|afternoon|evening), ${freshAccount.name.split(' ')[0]}$`),
    );
    await expect(homePage.emptyStateTitle).toBeVisible();
    await expect(page.getByTestId('first-run-drop-hint')).toContainText(
      'Drop a statement file here',
    );
    await expect(
      page.getByRole('region', {name: 'Getting started'}).getByRole('listitem'),
    ).toHaveText(['Import a statement', 'Check your categories']);
    await expect(page.getByRole('button', {name: 'Customize'})).toHaveCount(0);

    await homePage.chooseBankButton.click();
    // The first run keeps a centred dialog, not the side sheet.
    const sheet = page.getByTestId('add-data-sheet');
    await pickAbnAmro(sheet);
    await animationsSettled(sheet);
    const box = await boxOf(sheet);
    // Clear of both edges, with the page above and below it.
    expect(box.x).toBeGreaterThan(400);
    expect(1440 - box.x - box.width).toBeGreaterThan(400);
    expect(box.height).toBeLessThan(900);

    try {
      await dropOn(page, sheet.getByTestId('bank-import-drop-area'));
      await checkAndImport(sheet);
      await expect(sheet.getByRole('heading', {name: 'Building your Home'})).toBeVisible();
    } finally {
      release();
    }

    // Only Check what we found stood between the drop and the filled Home.
    await expect(sheet).toBeHidden();
    await expectFilledHome(page);
    expect(imports).toHaveLength(1);
    expect(sentForm(imports[0])).toEqual({files: [FILE.name], fields: {bankId: 'abn-amro'}});

    // The name typed stays the account's name.
    await page.reload();
    await expect(
      page.getByRole('main').getByRole('region', {name: 'Accounts', exact: true}),
    ).toContainText('Example current account');
  });
});

test.describe('First run on an iPhone', () => {
  test.use({timezoneId: 'Europe/Amsterdam', serviceWorkers: 'block', userAgent: IPHONE_SAFARI});

  test('chooses the file from the bank’s website, fills Home the same way, then offers to install below the check row', async ({
    page,
    homePage,
    freshAccount: _account,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    const {imports, release} = await holdImports(page);
    release();
    await openHome(page);
    await expect(homePage.emptyStateTitle).toBeVisible();
    await expect(page.getByTestId('first-run-drop-hint')).toHaveCount(0);

    await homePage.chooseBankButton.click();
    const sheet = page.getByTestId('add-data-sheet');
    await pickAbnAmro(sheet);
    await expect(sheet).toContainText('Banking apps usually can’t export a statement');
    await expect(sheet.getByTestId('bank-import-drop-area')).toHaveCount(0);
    const choose = sheet.getByRole('button', {name: 'Choose the file'});
    expect((await boxOf(choose)).width).toBeGreaterThan(300);
    const chooser = page.waitForEvent('filechooser');
    await choose.click();
    await (await chooser).setFiles([FILE]);

    await checkAndImport(sheet);
    await expect(sheet).toBeHidden();
    await expectFilledHome(page);
    expect(sentForm(imports[0]).fields).toEqual({bankId: 'abn-amro'});
    await expect(
      page
        .getByRole('main')
        .getByRole('region', {name: 'To do', exact: true})
        .getByRole('listitem')
        .nth(1),
    ).toContainText('Add Tempo to your Home Screen');
  });
});

test.describe('Home while a new bank fetches', () => {
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  test('waits for the first fetch instead of showing empty figures, with no greeting without a name, then shows its cards', async ({
    page,
    homePage,
  }) => {
    let connection: BankConnection = {
      ...HOME_CONNECTION,
      lastSyncedAt: null,
      lastSuccessfulSyncAt: null,
      // The first fetch waits out the bank's rate limit; the list is read again until it has fetched.
      syncStatus: 'RATE_LIMITED',
    };
    await mockSyntheticHome(page, {connections: () => [connection], clock: 'installed'});
    // Nothing is in until the bank has fetched: the newest transactions are none.
    await page.route('**/bank-transactions?**', (route) =>
      ['fetch', 'xhr'].includes(route.request().resourceType()) &&
      connection.lastSyncedAt === null &&
      !new URL(route.request().url()).searchParams.has('filter[date][from]')
        ? fulfillJson(route, monthTransactions('2026-11', 0))
        : route.fallback(),
    );
    await mockJson(page, '**/accounts/me', createAccount({email: 'owner@example.com', name: ''}));
    await page.goto('/');

    await expect(page.getByRole('heading', {name: 'Your data is on its way'})).toBeVisible();
    await expect(page.getByRole('main')).toContainText(
      `${HOME_CONNECTION.aspspName} is sending your transactions.`,
    );
    await expect(homePage.paceCard).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Customize'})).toHaveCount(0);
    // Without a name there is no greeting: the page's name is there for assistive technology only.
    const title = page.getByRole('heading', {level: 1});
    await expect(title).toHaveText('Home');
    expect((await boxOf(title)).height).toBeLessThanOrEqual(1);

    // The list is read again while the fetch runs; once it has fetched, Home shows its cards.
    connection = {...HOME_CONNECTION};
    await page.clock.runFor(5_000);
    await expect(homePage.paceFigure).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Your data is on its way'})).toHaveCount(0);
  });
});
