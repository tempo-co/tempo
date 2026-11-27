import type {Page, Route} from '@playwright/test';
import {BANK_LIST, type CreateBankRequest, OTHER_BANK_EXPORT_TEXT} from '@tempo/contracts';

import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {API_URL, expect, test} from '../../fixtures';
import {mockBankConnections} from '../../utils/api-mocks';
import {routeMockedBankApp} from '../../utils/bank-connections';
import {
  TODAY,
  created,
  importSummary,
  mockFileImport,
  refused,
  sentForm,
  statement,
} from '../../utils/file-import';
import {animationsSettled, boxOf} from '../../utils/layout';
import {countAfterToasts} from '../../utils/toasts';

const VERIFIED = BANK_LIST.filter((bank) => bank.status === 'verified');
const UNVERIFIED = BANK_LIST.filter((bank) => bank.status === 'unverified');
const RABOBANK = BANK_LIST.find((bank) => bank.id === 'rabobank')!;
const BOURSOBANK = BANK_LIST.find((bank) => bank.id === 'boursobank')!;

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
  });

  test.beforeEach(async ({page, baseURL}) => {
    await page.clock.setFixedTime(TODAY);
    await routeMockedBankApp(page, baseURL);
    await mockBankConnections(page, [MOCK_CONNECTION]);
  });

  test("lists verified banks, then not yet verified ones, then Another bank, and imports with the picked bank's id", async ({
    page,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    const api = await mockFileImport(page, {
      uploads: [created(importSummary({bankId: RABOBANK.id}))],
    });
    const sheet = await openPicker(page);

    // Search waits for a tap: nothing is focused for the owner.
    const search = sheet.getByRole('searchbox', {name: 'Search banks'});
    await expect(search).not.toBeFocused();

    const groups = sheet.getByRole('list');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toHaveAccessibleName('Verified');
    await expect(groups.nth(1)).toHaveAccessibleName('Not yet verified');
    await expect(groups.nth(2)).toHaveAccessibleName('Other banks');
    await expect(groups.nth(0).getByRole('button')).toHaveCount(VERIFIED.length);
    await expect(groups.nth(1).getByRole('button')).toHaveCount(UNVERIFIED.length);
    await expect(groups.nth(0).getByRole('button').first()).toContainText(VERIFIED[0].name);
    await expect(groups.nth(1).getByRole('button').first()).toContainText(UNVERIFIED[0].name);
    await expect(groups.nth(2).getByRole('button')).toHaveText(/^Another bank/);
    // Rows a thumb can hit: 56px on phones.
    expect((await boxOf(groups.nth(0).getByRole('button').first())).height).toBeGreaterThanOrEqual(
      56,
    );

    // A search keeps the groups' order and always leaves Another bank.
    await search.fill('bourso');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAccessibleName('Not yet verified');
    await expect(groups.nth(0).getByRole('button')).toHaveText([/^BoursoBank/]);
    await expect(groups.nth(1).getByRole('button')).toHaveText(/^Another bank/);

    // A bank not yet verified shows its researched steps, and says no file of it was tested.
    await groups.nth(0).getByRole('button').click();
    await expect(sheet.getByRole('heading', {name: 'Import a file'})).toBeVisible();
    await expect(sheet.getByText('Not yet verified')).toBeVisible();
    const steps = sheet.getByRole('list', {name: `How to get the file from ${BOURSOBANK.name}`});
    await expect(steps.getByRole('listitem')).toHaveText([...BOURSOBANK.exportSteps.steps]);
    await expect(sheet.getByText(`No ${BOURSOBANK.name} file has been tested yet.`)).toBeVisible();

    // Changing the bank goes back to the picker, where a verified bank's steps follow the same way.
    await sheet.getByRole('button', {name: 'Change bank'}).click();
    await expect(sheet.getByRole('heading', {name: 'Which bank is the file from?'})).toBeVisible();
    await sheet.getByRole('button', {name: new RegExp(`^${RABOBANK.name}`)}).click();
    await expect(
      sheet
        .getByRole('list', {name: `How to get the file from ${RABOBANK.name}`})
        .getByRole('listitem'),
    ).toHaveText([...RABOBANK.exportSteps.steps]);
    await expect(sheet.getByText('Not yet verified')).toHaveCount(0);

    await sheet.getByTestId('bank-import-file-input').setInputFiles([statement('rabobank.csv')]);
    await expect(sheet.getByRole('heading', {name: /^Imported/})).toBeVisible();
    expect(sentForm(api.uploads[0])).toEqual({
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
      "Tempo couldn't work out this file's columns",
    );
    expect(sentForm(api.uploads[0]).fields).toEqual({bankId: 'other'});
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
