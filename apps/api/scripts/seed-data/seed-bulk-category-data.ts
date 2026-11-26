import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {DeepPartial, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankingFixtures, bookedRow} from './banking-fixtures';
import {BULK_CATEGORY_ACCOUNT_EMAIL} from './seed.constants';

/** Fixed ids, so the web spec can put its rows back before each run. */
export const SEEDED_BULK_CATEGORY_IDS = {
	cafeToCheckNewest: '00000000-0000-4000-8000-000000000301',
	cafeToCheckMiddle: '00000000-0000-4000-8000-000000000302',
	cafeToCheckOldest: '00000000-0000-4000-8000-000000000303',
	bakeryToCheck: '00000000-0000-4000-8000-000000000304',
	marketGroceries: '00000000-0000-4000-8000-000000000305',
	cafeShoppingNewer: '00000000-0000-4000-8000-000000000306',
	cafeShoppingOlder: '00000000-0000-4000-8000-000000000307',
} as const;

const EXAMPLE_CAFE = {description: 'Example Cafe', counterpartyName: 'Example Cafe'};
const TO_CHECK = {category: 'NEEDS_REVIEW'};

/** A row the model has categorized, with the input hash sync stores. */
function row(id: string, bookingDate: string, amount: string, overrides: DeepPartial<BankTransaction>) {
	return bookedRow(bookingDate, amount, {id, categoryInputHash: `seed-bulk-${id}`, ...overrides});
}

/**
 * Seeds an owner for the bulk category flow: three Example Cafe rows to check on the newest days, two more Example
 * Cafe rows in Shopping, one Example Bakery row to check and one Example Market row in Groceries.
 */
export async function seedBulkCategoryData(app: INestApplicationContext) {
	const account = await app
		.get<Repository<Account>>(getRepositoryToken(Account))
		.findOneByOrFail({email: BULK_CATEGORY_ACCOUNT_EMAIL});
	const fixtures = new BankingFixtures(app);
	const connection = await fixtures.createConnection(account, {
		providerSessionId: 'seed-bulk-category-session',
		lastSyncedAt: new Date('2026-09-21T12:00:00.000Z'),
	});
	const bankAccount = await fixtures.createBankAccount(connection, {
		providerAccountId: 'seed-bulk-category-account',
		identificationHash: 'seed-bulk-category-hash',
	});
	const ids = SEEDED_BULK_CATEGORY_IDS;
	await fixtures.createTransactions(bankAccount, [
		row(ids.cafeToCheckNewest, '2026-09-20', '-4.50', {...EXAMPLE_CAFE, ...TO_CHECK}),
		row(ids.cafeToCheckMiddle, '2026-09-19', '-3.20', {...EXAMPLE_CAFE, ...TO_CHECK}),
		row(ids.cafeToCheckOldest, '2026-09-18', '-5.10', {...EXAMPLE_CAFE, ...TO_CHECK}),
		row(ids.bakeryToCheck, '2026-09-16', '-2.80', {
			description: 'Example Bakery',
			counterpartyName: 'Example Bakery',
			...TO_CHECK,
		}),
		row(ids.marketGroceries, '2026-09-15', '-23.40', {
			description: 'Example Market',
			counterpartyName: 'Example Market',
			category: 'GROCERIES',
		}),
		row(ids.cafeShoppingNewer, '2026-09-12', '-6.00', {...EXAMPLE_CAFE, category: 'SHOPPING'}),
		row(ids.cafeShoppingOlder, '2026-09-08', '-4.00', {...EXAMPLE_CAFE, category: 'SHOPPING'}),
	]);
}
