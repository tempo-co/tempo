import type {Page, Route} from '@playwright/test';
import {BANK_LIST, type CreateBankRequest, OTHER_BANK_EXPORT_TEXT} from '@wisp/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {mockBankConnections, mockJson} from '../../utils/api-mocks';
import {routeMockedBankApp} from '../../utils/bank-connections';
import {
  TODAY,
  created,
  importFound,
  importSummary,
  mockFileImport,
  refused,
  sentForm,
  statement,
} from '../../utils/file-import';
import {animationsSettled, boxOf} from '../../utils/layout';
import {countAfterToasts} from '../../utils/toasts';

const RABOBANK = BANK_LIST.find((bank) => bank.id === 'rabobank')!;
const BOURSOBANK = BANK_LIST.find((bank) => bank.id === 'boursobank')!;
const DUTCH = BANK_LIST.filter((bank) => bank.country === 'NL');
const FRENCH = BANK_LIST.filter((bank) => bank.country === 'FR');
const SEVERAL_COUNTRIES = BANK_LIST.filter((bank) => bank.country === null);
const UNTESTED =
  "We haven't seen a file from this bank yet. If we can't read it straight away, we'll ask you to check its columns once.";
/** A 1×1 PNG, as a connectable bank's logo. */
const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

/** Add data, then Import a statement file: the bank picker. */
async function openPicker(page: Page) {
  await page.goto('/settings/profile');
  await page.getByRole('button', {name: 'Add data'}).click();
  const sheet = page.getByTestId('add-data-sheet');
  await sheet.getByRole('button', {name: /^Import a statement file/}).click();
  await expect(sheet.getByRole('heading', {name: 'Which bank is the file from?'})).toBeVisible();
  await animationsSettled(sheet);
  return sheet;
}

test.describe('the bank picker in Add data', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    serviceWorkers: 'block',
    timezoneId: 'Europe/Amsterdam',
    locale: 'en-NL',
  });

  test.beforeEach(async ({page, baseURL}) => {
    await page.clock.setFixedTime(TODAY);
    await routeMockedBankApp(page, baseURL);
    await mockBankConnections(page, [MOCK_CONNECTION]);
  });

  test("lists the likely country's banks, then the banks of several countries, then Another bank, and imports with the picked bank's id", async ({
    page,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    // The logos Connect a bank shows: a Dutch bank's under its name in any case, an app bank's under its home country.
    await mockJson(page, '**/bank-connections/aspsps', [
      {name: 'RABOBANK', country: 'NL', logoUrl: LOGO},
      {name: 'Revolut', country: 'LT', logoUrl: LOGO},
      {name: 'Knab', country: 'DE', logoUrl: LOGO},
    ]);
    const api = await mockFileImport(page, {
      uploads: [created(importSummary({bankId: RABOBANK.id}))],
    });
    const sheet = await openPicker(page);

    // Search waits for a tap: nothing is focused for the owner.
    const search = sheet.getByRole('searchbox', {name: 'Search banks in every country'});
    await expect(search).not.toBeFocused();

    // The browser's region is the country the picker opens at.
    const country = sheet.getByTestId('bank-import-country');
    await expect(country).toContainText('Netherlands');
    const rows = sheet.getByRole('list').getByRole('button');
    await expect(rows).toHaveCount(DUTCH.length + SEVERAL_COUNTRIES.length + 1);
    for (const [index, bank] of [...DUTCH, ...SEVERAL_COUNTRIES].entries())
      await expect(rows.nth(index)).toContainText(bank.name);
    await expect(rows.nth(DUTCH.length)).toContainText('Several countries');
    await expect(rows.last()).toHaveText(/^Another bank/);
    // Rows a thumb can hit: 56px on phones.
    expect((await boxOf(rows.first())).height).toBeGreaterThanOrEqual(56);
    // A bank Connect a bank has a logo for shows it; any other gets the plain bank glyph.
    const logo = (name: string) =>
      sheet.getByRole('button', {name}).getByTestId('bank-wordmark').locator('img');
    await expect(logo(RABOBANK.name)).toHaveAttribute('src', LOGO);
    await expect(logo('Revolut')).toHaveAttribute('src', LOGO);
    await expect(logo('Knab')).toHaveCount(0);
    await expect(logo('Another bank')).toHaveCount(0);

    // Another country lists its own banks.
    await country.click();
    await expect(sheet.getByRole('heading', {name: 'Choose a country'})).toBeVisible();
    await sheet.getByRole('button', {name: /^France/}).click();
    await expect(country).toContainText('France');
    await expect(rows).toHaveCount(FRENCH.length + SEVERAL_COUNTRIES.length + 1);
    await expect(rows.first()).toContainText(FRENCH[0].name);

    // A search covers every country and always leaves Another bank.
    await search.fill('sparkasse');
    await expect(rows).toHaveText([/^Sparkasse\s*Germany$/, /^Another bank/]);
    await search.fill('bourso');

    // A bank no file of which has been read yet shows its researched steps and says what happens if it can't be read.
    await sheet.getByRole('button', {name: BOURSOBANK.name}).click();
    await expect(sheet.getByRole('heading', {name: 'Import a file'})).toBeVisible();
    const steps = sheet.getByRole('list', {name: `How to get the file from ${BOURSOBANK.name}`});
    await expect(steps.getByRole('listitem')).toHaveText([...BOURSOBANK.exportSteps.steps]);
    await expect(sheet.getByText(UNTESTED)).toBeVisible();

    // Changing the bank goes back to the picker, where a verified bank's steps follow the same way.
    await sheet.getByRole('button', {name: 'Change bank'}).click();
    await expect(sheet.getByRole('heading', {name: 'Which bank is the file from?'})).toBeVisible();
    await expect(country).toContainText('France');
    await search.fill('rabo');
    await sheet.getByRole('button', {name: RABOBANK.name}).click();
    await expect(
      sheet
        .getByRole('list', {name: `How to get the file from ${RABOBANK.name}`})
        .getByRole('listitem'),
    ).toHaveText([...RABOBANK.exportSteps.steps]);
    await expect(sheet.getByText(UNTESTED)).toHaveCount(0);

    await sheet.getByTestId('bank-import-file-input').setInputFiles([statement('rabobank.csv')]);
    await importFound(sheet);
    await expect(sheet.getByRole('heading', {name: /^Imported/})).toBeVisible();
    // The drop is read, then imported, with the picked bank's id.
    for (const request of [api.previews[0], api.uploads[0]])
      expect(sentForm(request)).toEqual({
        files: ['rabobank.csv'],
        fields: {bankId: RABOBANK.id},
      });
  });

  test('a file whose columns cannot be worked out leads to Tell us your bank, which sends no file', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    const api = await mockFileImport(page, {
      mapper: true,
      uploads: [refused({code: 'layout_unknown', file: 1})],
      proposals: [refused({code: 'layout_not_mappable', file: 1})],
    });
    const requests: {contentType: string | null; body: unknown}[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${API_URL}/bank-imports/bank-requests`, async (route: Route) => {
      requests.push({
        contentType: await route.request().headerValue('content-type'),
        body: route.request().postDataJSON(),
      });
      // The first send fails; the one after it goes through.
      if (requests.length === 1)
        return route.fulfill({status: 500, json: {statusCode: 500, message: 'Server error'}});
      await held;
      await route.fulfill({status: 204});
    });
    const sheet = await openPicker(page);

    // Another bank: one text for any bank.
    await sheet.getByRole('button', {name: /^Another bank/}).click();
    await expect(sheet.getByText(OTHER_BANK_EXPORT_TEXT)).toBeVisible();
    await sheet.getByTestId('bank-import-file-input').setInputFiles([statement('export.csv')]);
    await sheet.getByRole('button', {name: 'Work out the columns'}).click();
    await expect(sheet.getByRole('alert')).toContainText(
      "Wisp couldn't work out this file's columns",
    );
    expect(sentForm(api.previews[0]).fields).toEqual({bankId: 'other'});
    expect(sentForm(api.proposals[0]).fields).toEqual({bankId: 'other'});

    await sheet.getByRole('button', {name: 'Tell us your bank'}).click();
    await expect(sheet.getByRole('heading', {name: 'Tell us your bank'})).toBeVisible();
    await expect(
      sheet.getByText("Your file isn't sent, and we don't reply to these."),
    ).toBeVisible();
    const send = sheet.getByRole('button', {name: 'Send'});
    await expect(send).toBeDisabled();

    await sheet.getByLabel('Bank name').fill('Example Regional Bank');
    await sheet.getByRole('combobox', {name: 'Country'}).click();
    await page.getByRole('option', {name: 'Netherlands'}).click();
    const fileTypes = sheet.getByRole('group', {name: 'Files it lets you download'});
    // Sent in the list's order, whatever order they are pressed in.
    await fileTypes.getByRole('button', {name: 'Excel'}).click();
    await fileTypes.getByRole('button', {name: 'CSV'}).click();
    await expect(fileTypes.getByRole('button', {name: 'CSV'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A failed send says so in the form, which keeps what was typed.
    await send.click();
    await expect(sheet.getByRole('alert')).toContainText("Couldn't send this");
    expect(await countAfterToasts(page, page.locator('[data-sonner-toast]'))).toBe(0);
    await expect(sheet.getByLabel('Bank name')).toHaveValue('Example Regional Bank');

    await send.click();
    try {
      await expect(sheet.getByRole('button', {name: 'Sending…'})).toBeDisabled();
    } finally {
      release();
    }
    await expect(sheet.getByRole('status')).toContainText(
      "Thanks. We read every request, but we don't reply.",
    );
    const sent = {
      contentType: 'application/json',
      body: {
        bankName: 'Example Regional Bank',
        country: 'NL',
        fileTypes: ['csv', 'excel'],
      } satisfies CreateBankRequest,
    };
    expect(requests).toEqual([sent, sent]);

    await sheet.getByRole('button', {name: 'Done'}).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('the bank picker for a browser whose region it does not list', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    serviceWorkers: 'block',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  });

  test("opens at the country of the account's time zone", async ({page, baseURL}) => {
    await page.clock.setFixedTime(TODAY);
    // The mocked account's time zone is Europe/Amsterdam.
    await routeMockedBankApp(page, baseURL);
    await mockBankConnections(page, [MOCK_CONNECTION]);
    await mockFileImport(page);
    const sheet = await openPicker(page);

    await expect(sheet.getByTestId('bank-import-country')).toContainText('Netherlands');
    await expect(sheet.getByRole('list').getByRole('button').first()).toContainText(DUTCH[0].name);
  });
});
