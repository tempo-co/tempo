import type {Page} from '@playwright/test';

import {expect, test} from '../../fixtures';
import {animationsSettled, expectNoHorizontalOverflow} from '../../utils/layout';

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

/** Drags `file` over the page column and drops it there, as a file dragged in from the desktop. */
async function dropOnPage(page: Page, file: {name: string; content: string}) {
  const transfer = await page.evaluateHandle(({name, content}) => {
    const data = new DataTransfer();
    data.items.add(new File([content], name));
    return data;
  }, file);
  const column = page.locator('main');
  await column.dispatchEvent('dragenter', {dataTransfer: transfer});
  await expect(page.getByTestId('bank-import-page-drop')).toContainText('Drop to import');
  await column.dispatchEvent('dragover', {dataTransfer: transfer});
  await column.dispatchEvent('drop', {dataTransfer: transfer});
}

test.describe('Add data', () => {
  test.use({timezoneId: 'Europe/Amsterdam'});

  test('a statement dropped on Transactions imports in the Add data sheet and its account shows on Accounts', async ({
    page,
    freshAccount: _account,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/transactions');
    await expect(page.getByRole('heading', {name: 'Transactions', level: 1})).toBeVisible();

    await dropOnPage(page, {name: 'example-statement.xml', content: STATEMENT});
    const sheet = page.getByTestId('add-data-sheet');
    await expect(sheet.getByRole('heading', {name: 'Imported 1 file'})).toBeVisible();
    // A side sheet over the page, not a centred dialog: it runs the window's full height.
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThan(720);
    expect(Math.round(box.height)).toBe(900);
    await expect(page).toHaveURL(/\/transactions$/);
    await sheet.getByRole('button', {name: 'Done'}).click();
    await expect(sheet).toBeHidden();

    await page.getByRole('link', {name: 'Accounts'}).click();
    const row = page.getByTestId(/^account-row-/);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('statement files');
    await expect(row.getByTestId('account-freshness')).toContainText('File up to 10 Mar');
    await page.getByRole('tab', {name: 'Imports'}).click();
    await expect(page.getByTestId('bank-import-row')).toContainText('3 new');
  });

  test('a file Tempo cannot read is refused inside the sheet, and nothing is imported', async ({
    page,
    freshAccount: _account,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/insights');
    await dropOnPage(page, {name: 'holiday-photo.heic', content: 'not a statement'});

    const sheet = page.getByTestId('add-data-sheet');
    const alert = sheet.getByRole('alert');
    await expect(alert).toContainText("Tempo can't read this file");
    await expect(alert).toContainText('Nothing was imported.');
    await sheet.getByRole('button', {name: 'Close'}).click();

    await page.goto('/accounts');
    await expect(page.getByRole('heading', {name: 'No accounts yet'})).toBeVisible();
  });

  test('on a phone, Add data opens one bottom sheet with no sideways scroll', async ({
    page,
    freshAccount: _account,
  }) => {
    await page.setViewportSize({width: 320, height: 640});
    await page.goto('/transactions');
    await page.getByRole('button', {name: 'Add data'}).click();
    const sheet = page.getByTestId('add-data-sheet');
    await expect(sheet.getByRole('heading', {name: 'Add data'})).toBeVisible();
    await animationsSettled(sheet);
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(640);
    expect(Math.round(box.width)).toBe(320);
    await expectNoHorizontalOverflow(page);

    await sheet.getByRole('button', {name: /^Import a statement file/}).click();
    await expect(sheet.getByRole('heading', {name: 'Import a file'})).toBeVisible();
    await expect(sheet.getByRole('button', {name: 'Choose files'})).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', {name: 'Back to Add data'}).click();
    await sheet.getByRole('button', {name: /^Connect a bank/}).click();
    await expect(sheet.getByRole('heading', {name: 'Connect a bank'})).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
