import {QueryRunner} from 'typeorm';

import {
	assignBankTransactionStableIdentityKeys,
	createBankTransactionStableIdentityGroupKey,
} from '../../modules/banking/bank-transaction-identity';
import type {BankTransactionIdentityInput} from '../../modules/banking/bank-transaction-identity';
import {AddBankTransactionStableIdentity20260928154959} from './migrations/20260928154959-add-bank-transaction-stable-identity';

describe('AddBankTransactionStableIdentity migration', () => {
	it('backfills account-scoped identity groups and distinct occurrence keys', async () => {
		const accountA = '10000000-0000-4000-8000-000000000001';
		const accountB = '20000000-0000-4000-8000-000000000001';
		const sharedFields = {
			entryReference: null,
			transactionDate: null,
			bookingDate: '2026-09-01',
			valueDate: null,
			amount: '12.00000000',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			bankTransactionDescription: null,
			description: 'Synthetic repeated payment',
			counterpartyName: 'Synthetic Counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: null,
			referenceNumberScheme: null,
		};
		const rows: Array<BankTransactionIdentityInput & {id: string}> = [
			{...sharedFields, id: '30000000-0000-4000-8000-000000000001', bankAccountId: accountA},
			{...sharedFields, id: '30000000-0000-4000-8000-000000000002', bankAccountId: accountA},
			{...sharedFields, id: '30000000-0000-4000-8000-000000000003', bankAccountId: accountB},
		];
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(false),
			addColumn: jest.fn().mockResolvedValue(undefined),
			query: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(undefined),
			getTable: jest.fn().mockResolvedValue({indices: []}),
			createIndex: jest.fn().mockResolvedValue(undefined),
		} as unknown as QueryRunner;

		await new AddBankTransactionStableIdentity20260928154959().up(queryRunner);

		const selectSql = (queryRunner.query as jest.Mock).mock.calls[0][0] as string;
		expect(selectSql).toContain(`to_char("transactionDate", 'YYYY-MM-DD') AS "transactionDate"`);
		expect(selectSql).toContain(`to_char("bookingDate", 'YYYY-MM-DD') AS "bookingDate"`);
		expect(selectSql).toContain(`to_char("valueDate", 'YYYY-MM-DD') AS "valueDate"`);
		expect(queryRunner.addColumn).toHaveBeenCalledTimes(2);
		expect(queryRunner.query).toHaveBeenCalledTimes(2);
		const [updateSql, parameters] = (queryRunner.query as jest.Mock).mock.calls[1] as [string, string[]];
		expect(updateSql).toContain('UPDATE "bank_transactions"');
		expect(updateSql).toContain('"stableIdentityGroupKey" = batch."stableIdentityGroupKey"');
		expect(parameters.filter((_, index) => index % 3 === 0)).toEqual(rows.map(({id}) => id));
		const stableIdentityGroupKeys = parameters.filter((_, index) => index % 3 === 1);
		expect(stableIdentityGroupKeys).toEqual(rows.map(createBankTransactionStableIdentityGroupKey));
		expect(new Set(stableIdentityGroupKeys).size).toBe(2);
		const stableIdentityKeys = parameters.filter((_, index) => index % 3 === 2);
		expect(new Set(stableIdentityKeys).size).toBe(rows.length);
		expect(stableIdentityKeys).toEqual(
			assignBankTransactionStableIdentityKeys(rows).map(({stableIdentityKey}) => stableIdentityKey),
		);
		expect(queryRunner.createIndex).toHaveBeenNthCalledWith(
			1,
			'bank_transactions',
			expect.objectContaining({
				name: 'idx_bank_transactions_account_stable_identity',
				columnNames: ['bankAccountId', 'stableIdentityKey'],
				isUnique: true,
			}),
		);
		expect(queryRunner.createIndex).toHaveBeenNthCalledWith(
			2,
			'bank_transactions',
			expect.objectContaining({
				name: 'idx_bank_transactions_account_identity_group',
				columnNames: ['bankAccountId', 'stableIdentityGroupKey'],
				isUnique: false,
			}),
		);
	});

	it('backfills incomplete identities when the identity columns already exist', async () => {
		const row: BankTransactionIdentityInput & {id: string} = {
			id: '30000000-0000-4000-8000-000000000004',
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: null,
			transactionDate: null,
			bookingDate: '2026-09-01',
			valueDate: null,
			amount: '12.00000000',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			bankTransactionDescription: null,
			description: 'Synthetic existing transaction',
			counterpartyName: 'Synthetic Counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: null,
			referenceNumberScheme: null,
		};
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(true),
			addColumn: jest.fn().mockResolvedValue(undefined),
			query: jest
				.fn()
				.mockResolvedValueOnce([{hasIncompleteIdentity: true}])
				.mockResolvedValueOnce([row])
				.mockResolvedValueOnce(undefined),
			getTable: jest.fn().mockResolvedValue({indices: []}),
			createIndex: jest.fn().mockResolvedValue(undefined),
		} as unknown as QueryRunner;

		await new AddBankTransactionStableIdentity20260928154959().up(queryRunner);

		expect(queryRunner.addColumn).not.toHaveBeenCalled();
		expect(queryRunner.query).toHaveBeenCalledTimes(3);
		const incompleteIdentitySql = (queryRunner.query as jest.Mock).mock.calls[0][0] as string;
		expect(incompleteIdentitySql).toContain('"stableIdentityKey" IS NULL');
		expect(incompleteIdentitySql).toContain('"stableIdentityGroupKey" IS NULL');
		const selectSql = (queryRunner.query as jest.Mock).mock.calls[1][0] as string;
		expect(selectSql).toContain('FROM "bank_transactions"');
		const [updateSql, parameters] = (queryRunner.query as jest.Mock).mock.calls[2] as [string, string[]];
		expect(updateSql).toContain('UPDATE "bank_transactions"');
		expect(parameters).toContain(row.id);
		expect(queryRunner.createIndex).toHaveBeenCalledTimes(2);
	});

	it('preserves existing occurrence keys when repairing incomplete rows', async () => {
		const existingTransaction: BankTransactionIdentityInput = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: null,
			transactionDate: null,
			bookingDate: '2026-09-01',
			valueDate: null,
			amount: '12.00000000',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			bankTransactionDescription: null,
			description: 'Z corrected mutable details',
			counterpartyName: 'Synthetic Counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: null,
			referenceNumberScheme: null,
		};
		const existingIdentity = assignBankTransactionStableIdentityKeys([existingTransaction])[0];
		const existingRow = {
			...existingTransaction,
			id: '30000000-0000-4000-8000-000000000005',
			stableIdentityKey: existingIdentity.stableIdentityKey,
			stableIdentityGroupKey: existingIdentity.stableIdentityGroupKey,
		};
		const incompleteRow = {
			...existingTransaction,
			id: '30000000-0000-4000-8000-000000000006',
			description: 'A new occurrence with mutable details',
			stableIdentityKey: null,
			stableIdentityGroupKey: null,
		};
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(true),
			query: jest
				.fn()
				.mockResolvedValueOnce([{hasIncompleteIdentity: true}])
				.mockResolvedValueOnce([existingRow, incompleteRow])
				.mockResolvedValueOnce(undefined),
			getTable: jest.fn().mockResolvedValue({indices: []}),
			createIndex: jest.fn().mockResolvedValue(undefined),
		} as unknown as QueryRunner;

		await new AddBankTransactionStableIdentity20260928154959().up(queryRunner);

		const [, parameters] = (queryRunner.query as jest.Mock).mock.calls[2] as [string, string[]];
		expect(parameters.filter((_, index) => index % 3 === 0)).toEqual([incompleteRow.id]);
		expect(parameters.filter((_, index) => index % 3 === 1)).toEqual([existingIdentity.stableIdentityGroupKey]);
		expect(parameters.filter((_, index) => index % 3 === 2)).not.toContain(existingIdentity.stableIdentityKey);
	});

	it('replaces same-named identity indexes whose definitions do not match', async () => {
		const stableIndex = {
			name: 'idx_bank_transactions_account_stable_identity',
			columnNames: ['bankAccountId', 'wrongColumn'],
			isUnique: false,
		};
		const groupIndex = {
			name: 'idx_bank_transactions_account_identity_group',
			columnNames: ['bankAccountId', 'stableIdentityGroupKey'],
			isUnique: true,
		};
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(true),
			query: jest.fn().mockResolvedValue([{hasIncompleteIdentity: false}]),
			getTable: jest.fn().mockResolvedValue({indices: [stableIndex, groupIndex]}),
			dropIndex: jest.fn().mockResolvedValue(undefined),
			createIndex: jest.fn().mockResolvedValue(undefined),
		} as unknown as QueryRunner;

		await new AddBankTransactionStableIdentity20260928154959().up(queryRunner);

		expect(queryRunner.dropIndex).toHaveBeenNthCalledWith(1, 'bank_transactions', stableIndex);
		expect(queryRunner.dropIndex).toHaveBeenNthCalledWith(2, 'bank_transactions', groupIndex);
		expect(queryRunner.createIndex).toHaveBeenNthCalledWith(
			1,
			'bank_transactions',
			expect.objectContaining({
				name: 'idx_bank_transactions_account_stable_identity',
				columnNames: ['bankAccountId', 'stableIdentityKey'],
				isUnique: true,
			}),
		);
		expect(queryRunner.createIndex).toHaveBeenNthCalledWith(
			2,
			'bank_transactions',
			expect.objectContaining({
				name: 'idx_bank_transactions_account_identity_group',
				columnNames: ['bankAccountId', 'stableIdentityGroupKey'],
				isUnique: false,
			}),
		);
	});

	it('refuses rollback when dedupe keys are incompatible with the legacy sync path', async () => {
		const identityIndex = {name: 'idx_bank_transactions_account_stable_identity'};
		const groupIndex = {name: 'idx_bank_transactions_account_identity_group'};
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(true),
			getTable: jest.fn().mockResolvedValue({indices: [identityIndex, groupIndex]}),
			query: jest.fn().mockResolvedValue([{hasIncompatibleDedupeKey: true}]),
			dropIndex: jest.fn().mockResolvedValue(undefined),
			dropColumn: jest.fn().mockResolvedValue(undefined),
		} as unknown as QueryRunner;

		await expect(new AddBankTransactionStableIdentity20260928154959().down(queryRunner)).rejects.toThrow(
			'Cannot safely roll back stable transaction identities',
		);
		expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining('SELECT EXISTS'));
		expect(queryRunner.dropIndex).not.toHaveBeenCalled();
		expect(queryRunner.dropColumn).not.toHaveBeenCalled();
	});

	it('allows rollback when no incompatible dedupe keys exist', async () => {
		const identityIndex = {name: 'idx_bank_transactions_account_stable_identity'};
		const groupIndex = {name: 'idx_bank_transactions_account_identity_group'};
		const queryRunner = {
			hasTable: jest.fn().mockResolvedValue(true),
			hasColumn: jest.fn().mockResolvedValue(true),
			getTable: jest.fn().mockResolvedValue({indices: [identityIndex, groupIndex]}),
			dropIndex: jest.fn().mockResolvedValue(undefined),
			dropColumn: jest.fn().mockResolvedValue(undefined),
			query: jest.fn().mockResolvedValue([{hasIncompatibleDedupeKey: false}]),
		} as unknown as QueryRunner;

		await new AddBankTransactionStableIdentity20260928154959().down(queryRunner);

		const rollbackSql = (queryRunner.query as jest.Mock).mock.calls[0][0] as string;
		expect(rollbackSql).toContain('SELECT EXISTS');
		expect(rollbackSql).toContain('"dedupeKey" IS NULL OR "dedupeKey" !~');
		expect(rollbackSql).toContain('^[a-f0-9]{64}$');
		expect(queryRunner.dropIndex).toHaveBeenNthCalledWith(1, 'bank_transactions', identityIndex);
		expect(queryRunner.dropIndex).toHaveBeenNthCalledWith(2, 'bank_transactions', groupIndex);
		expect(queryRunner.dropColumn).toHaveBeenNthCalledWith(1, 'bank_transactions', 'stableIdentityGroupKey');
		expect(queryRunner.dropColumn).toHaveBeenNthCalledWith(2, 'bank_transactions', 'stableIdentityKey');
		expect(queryRunner.query).toHaveBeenCalledTimes(1);
	});
});
