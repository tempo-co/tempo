import type {BankTransaction, BankTransactionCounterpart} from '@tempo/contracts';

import {formatBankTransactionExchangeRate} from '../../../src/features/banking/utils/formatters';
import {API_URL, expect, test} from '../../fixtures';
import {mockBankConnections, mockBankRefresh, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const OUT = '00000000-0000-4000-8000-000000000901';
const IN = '00000000-0000-4000-8000-000000000902';
const logo = (color: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`,
  );
const logos = {Alpha: logo('#808080'), Beta: logo('#4080c0')};
const outgoing: BankTransaction = {
  id: OUT,
  transactionDate: '2026-10-14',
  bookingDate: '2026-10-14',
  valueDate: null,
  description: 'Example account movement',
  displayDescription: 'Example account movement',
  counterpartyName: null,
  merchantLogoUrl: null,
  merchantGroupId: null,
  amount: '-80.00',
  currency: 'EUR',
  creditDebitIndicator: 'DBIT',
  direction: 'EXPENSE',
  transactionType: 'TRANSFER',
  transactionStatus: 'BOOK',
  category: null,
  categoryStatus: 'COMPLETED',
  categorySource: null,
  categoryConfidence: null,
  financialEventType: null,
  financialEventSource: null,
  financialEventRuleVersion: null,
  cashFlowTreatment: 'INTERNAL',
  ownTransfer: null,
  ownTransferOverride: null,
  currencyExchangeCounterpart: null,
  providerTransactionDescription: null,
  merchantCategoryCode: null,
  remittanceInformation: null,
  balanceAfterAmount: null,
  balanceAfterCurrency: null,
  instructedAmount: null,
  instructedCurrency: null,
  exchangeRate: null,
  exchangeRateUnitCurrency: null,
  exchangeRateType: null,
  referenceNumber: null,
  referenceNumberScheme: null,
  amountInBaseCurrency: null,
  baseAmountMethod: null,
  baseAmountRateDate: null,
  bankName: 'Example Alpha Bank',
  bankCountry: 'NL',
  bankAccountName: 'Example Owner',
  bankAccountAlias: 'Example international household spending account',
};

function counterpart(transaction: BankTransaction): BankTransactionCounterpart {
  const {id, bankName, bankAccountName, bankAccountAlias, amount, currency, bookingDate} =
    transaction;
  return {id, bankName, bankAccountName, bankAccountAlias, amount, currency, bookingDate};
}

for (const width of [1440, 390, 320]) {
  for (const exchange of [false, true]) {
    test.describe(`${exchange ? 'exchange' : 'own transfer'} account context at ${width}px`, () => {
      test.use({storageState: {cookies: [], origins: []}, viewport: {width, height: 900}});
      test('aligns account facts and follows the linked leg', async ({page}) => {
        await mockJson(page, '**/accounts/me', {
          id: '00000000-0000-4000-8000-000000000900',
          name: 'Example Owner',
          email: 'movement@example.com',
          isEmailVerified: true,
        });
        await mockBankRefresh(page);
        await mockBankConnections(
          page,
          ['Alpha', 'Beta'].map((name, index) => ({
            id: `00000000-0000-4000-8000-00000000090${index + 3}`,
            provider: 'EXAMPLE',
            aspspName: `Example ${name} Bank`,
            aspspCountry: 'NL',
            status: 'AUTHORIZED',
            consentValidUntil: null,
            lastSyncedAt: null,
            lastSyncError: null,
            nextSyncAt: null,
            syncStatus: 'IDLE',
            baseCurrency: 'EUR',
            bankAccounts: [],
          })),
        );
        await mockJson(
          page,
          '**/bank-connections/aspsps',
          ['Alpha', 'Beta'].map((name) => ({
            name: `Example ${name} Bank`,
            country: 'NL',
            logoUrl: name === 'Alpha' ? logos.Alpha : logos.Beta,
          })),
        );
        const source = {...outgoing};
        const destination: BankTransaction = {
          ...source,
          id: IN,
          bankName: 'Example Beta Bank',
          bankAccountAlias: 'Example savings',
          amount: exchange ? '91.99' : '80.00',
          currency: exchange ? 'USD' : 'EUR',
          direction: 'INCOME',
          creditDebitIndicator: 'CRDT',
        };
        if (exchange) {
          for (const leg of [source, destination])
            Object.assign(leg, {
              financialEventType: 'CURRENCY_EXCHANGE',
              exchangeRate: '1.149876543210000000',
              exchangeRateUnitCurrency: 'EUR',
              exchangeRateType: 'SPOT',
            });
          source.currencyExchangeCounterpart = counterpart(destination);
          destination.currencyExchangeCounterpart = counterpart(source);
        } else {
          source.ownTransfer = {evidence: 'IBAN', counterpart: counterpart(destination)};
          destination.ownTransfer = {evidence: 'IBAN', counterpart: counterpart(source)};
        }
        for (const leg of [source, destination])
          await mockJson(page, `**/bank-transactions/${leg.id}`, leg);
        await mockJson(page, `${API_URL}/bank-transactions?**`, {
          transactions: [source, destination],
          total: 2,
        });
        await page.goto(`/bank-transactions?transactionId=${OUT}`);
        const inspector = page.getByTestId('bank-transaction-inspector');
        const movement = inspector.getByRole('region', {name: 'Money movement'});
        await expect(movement).toBeVisible();
        if (exchange) await expect(movement).toContainText('1 EUR ≈ 1.1499 USD');
        await inspector.evaluate(async (el) => {
          await Promise.all(
            el
              .getAnimations({subtree: true})
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished),
          );
        });
        const [fromLabel, toLabel] = await Promise.all([
          boxOf(movement.getByText('From', {exact: true})),
          boxOf(movement.getByText('To', {exact: true})),
        ]);
        if (width >= 640) expect(Math.abs(fromLabel.y - toLabel.y)).toBeLessThan(1);
        const from = movement.getByTestId('movement-own');
        const to = movement.getByTestId('movement-counterpart');
        await expect(from.getByTestId('bank-logo').locator('img')).toHaveJSProperty(
          'complete',
          true,
        );
        await expect(to.getByTestId('bank-logo').locator('img')).toHaveJSProperty(
          'naturalWidth',
          40,
        );
        await expect(from.getByTestId('bank-logo').locator('img')).toHaveAttribute(
          'src',
          logos.Alpha,
        );
        await expect(to.getByTestId('bank-logo').locator('img')).toHaveAttribute('src', logos.Beta);
        for (const row of ['label', 'account', 'bank', 'amount']) {
          const [left, right] = await Promise.all([
            boxOf(from.getByTestId(`movement-${row}`)),
            boxOf(to.getByTestId(`movement-${row}`)),
          ]);
          if (width >= 640) expect(Math.abs(left.y - right.y)).toBeLessThan(1);
        }
        await expect(from.getByTestId('movement-amount')).toHaveText('-€80.00');
        await expect(to).toContainText(exchange ? '$91.99' : '€80.00');
        if (exchange) await expect(movement).toContainText('1 EUR ≈ 1.1499 USD');
        await expectNoHorizontalOverflow(page);
        await to.click();
        await expect(page).toHaveURL(new RegExp(`transactionId=${IN}`));
        await expect(inspector.getByTestId('bank-transaction-detail-amount')).toContainText(
          exchange ? '$91.99' : '€80.00',
        );
        if (exchange) {
          await expect(movement).toContainText('1 EUR ≈ 1.1499 USD');
          await inspector.getByRole('button', {name: 'Bank details', exact: true}).click();
          await expect(
            inspector.getByText('1 EUR ≈ 1.1499 USD (SPOT)', {exact: true}),
          ).toBeVisible();
        }
      });
    });
  }
}

for (const {name, rate, unit, currency, instructed, expected} of [
  {
    name: 'small rates',
    rate: '0.000035891234',
    unit: 'VND',
    currency: 'EUR',
    instructed: null,
    expected: '1 VND ≈ 0.000035891 EUR',
  },
  {
    name: 'whole rates',
    rate: '1.000000000000000000',
    unit: 'EUR',
    currency: 'USD',
    instructed: null,
    expected: '1 EUR ≈ 1 USD',
  },
  {
    name: 'instructed currency',
    rate: '1.46812345',
    unit: 'EUR',
    currency: 'EUR',
    instructed: 'CAD',
    expected: '1 EUR ≈ 1.4681 CAD',
  },
  {
    name: 'unknown unit',
    rate: '1.14987654321',
    unit: null,
    currency: 'USD',
    instructed: null,
    expected: null,
  },
  {
    name: 'unknown quote',
    rate: '1.200000',
    unit: 'EUR',
    currency: 'EUR',
    instructed: null,
    expected: null,
  },
  {name: 'missing rate', rate: null, unit: null, currency: 'EUR', instructed: null, expected: null},
]) {
  test(`formats exchange quotes with ${name}`, () => {
    expect(
      formatBankTransactionExchangeRate({
        ...outgoing,
        exchangeRate: rate,
        exchangeRateUnitCurrency: unit,
        currency,
        instructedCurrency: instructed,
      }),
    ).toBe(expected);
  });
}
