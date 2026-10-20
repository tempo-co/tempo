import {DataSource} from 'typeorm';
import {z} from 'zod';

import {toBankTransactionDirection} from '../bank-transaction-direction';
import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '../categorization/bank-transaction-category';

export class RecurringPayeeAliasImportError extends Error {
	constructor(
		readonly code:
			| 'invalid_input'
			| 'source_missing'
			| 'owner_not_found'
			| 'group_purpose_mismatch'
			| 'group_direction_mismatch'
			| 'alias_conflict'
			| 'invalid_arguments'
			| 'invalid_database_config'
			| 'import_failed',
	) {
		super(`Recurring payee alias import rejected: ${code}`);
	}
}

const manifestSchema = z
	.object({
		aliases: z.array(
			z
				.object({
					merchantKey: z.string().refine((value) => value.trim().length > 0),
					category: z.enum(BANK_TRANSACTION_CATEGORIES),
					payeeGroupId: z.uuid(),
				})
				.strict(),
		),
	})
	.strict();

export type RecurringPayeeAliasInput = {
	merchantKey: string;
	category: BankTransactionCategory;
	payeeGroupId: string;
};

export type RecurringPayeeAliasImportResult = {
	dryRun: boolean;
	requested: number;
	wouldInsert: number;
	inserted: number;
	unchanged: number;
};

/** Imports owner-confirmed identities; source transactions are never changed. Defaults to a read-only preview. */
export async function importRecurringPayeeAliases(
	database: DataSource,
	accountId: string,
	input: unknown,
	options: {apply?: boolean} = {},
): Promise<RecurringPayeeAliasImportResult> {
	const parsed = manifestSchema.safeParse(input);
	if (!z.uuid().safeParse(accountId).success || !parsed.success) {
		throw new RecurringPayeeAliasImportError('invalid_input');
	}
	const {aliases} = parsed.data;
	const keys = aliases.map((alias) => JSON.stringify([alias.merchantKey, alias.category]));
	if (new Set(keys).size !== keys.length) throw new RecurringPayeeAliasImportError('invalid_input');
	return database
		.transaction(async (manager) => {
			const owners = (await manager.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId])) as {
				id: string;
			}[];
			if (owners.length === 0) throw new RecurringPayeeAliasImportError('owner_not_found');
			for (const alias of aliases) {
				const sources = (await manager.query(
					`SELECT DISTINCT t."creditDebitIndicator" FROM bank_transactions t
				JOIN bank_accounts ba ON ba.id = t."bankAccountId"
				JOIN bank_connections bc ON bc.id = ba."bankConnectionId"
				WHERE bc."accountId" = $1 AND t."merchantKey" = $2 AND t.category = $3`,
					[accountId, alias.merchantKey, alias.category],
				)) as {creditDebitIndicator: string | null}[];
				if (sources.length === 0) throw new RecurringPayeeAliasImportError('source_missing');
				const direction = alias.merchantKey.split(':')[0];
				if (
					!['EXPENSE', 'INCOME'].includes(direction) ||
					sources.some((source) => toBankTransactionDirection(source.creditDebitIndicator) !== direction)
				)
					throw new RecurringPayeeAliasImportError('group_direction_mismatch');
			}
			const groupRows = (await manager.query(
				`SELECT "merchantKey", category, "payeeGroupId" FROM recurring_payee_aliases
			WHERE "accountId" = $1 AND "payeeGroupId" = ANY($2::uuid[])`,
				[accountId, aliases.map((alias) => alias.payeeGroupId)],
			)) as RecurringPayeeAliasInput[];
			const groups = new Map<string, RecurringPayeeAliasInput>();
			for (const alias of [...groupRows, ...aliases]) {
				const groupId = alias.payeeGroupId.toLowerCase();
				const prior = groups.get(groupId);
				if (prior && prior.category !== alias.category)
					throw new RecurringPayeeAliasImportError('group_purpose_mismatch');
				if (prior && prior.merchantKey.split(':')[0] !== alias.merchantKey.split(':')[0]) {
					throw new RecurringPayeeAliasImportError('group_direction_mismatch');
				}
				groups.set(groupId, alias);
			}
			let inserted = 0;
			let unchanged = 0;
			for (const alias of aliases) {
				const existing = (await manager.query(
					`SELECT "payeeGroupId" FROM recurring_payee_aliases
				WHERE "accountId" = $1 AND "merchantKey" = $2 AND category = $3`,
					[accountId, alias.merchantKey, alias.category],
				)) as {payeeGroupId: string}[];
				if (existing.length > 0) {
					if (existing[0].payeeGroupId !== alias.payeeGroupId.toLowerCase()) {
						throw new RecurringPayeeAliasImportError('alias_conflict');
					}
					unchanged++;
					continue;
				}
				if (options.apply) {
					await manager.query(
						`INSERT INTO recurring_payee_aliases ("accountId", "merchantKey", category, "payeeGroupId")
					VALUES ($1, $2, $3, $4)`,
						[accountId, alias.merchantKey, alias.category, alias.payeeGroupId],
					);
					inserted++;
				}
			}
			return {
				dryRun: !options.apply,
				requested: aliases.length,
				wouldInsert: aliases.length - unchanged,
				inserted,
				unchanged,
			};
		})
		.catch((error: unknown) => {
			if (error instanceof RecurringPayeeAliasImportError) throw error;
			throw new RecurringPayeeAliasImportError('import_failed');
		});
}
