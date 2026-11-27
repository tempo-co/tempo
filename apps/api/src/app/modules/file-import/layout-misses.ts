import {BANK_LIST, BankImportErrorCode} from '@wisp/contracts';
import type {Bank} from '@wisp/contracts';
import {EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankImportLayoutMiss, LayoutMissOutcome} from './bank-import-layout-miss.entity';
import type {StatementFormat} from './parsers/parse-result';

export type LayoutMiss = {outcome: LayoutMissOutcome; refusalCode: BankImportErrorCode | null};

/** The bank a request picked when it is a verified one; null for none, an unverified bank or another bank. */
function verifiedBank(bankId: string | null): Bank | null {
	return BANK_LIST.find((bank) => bank.id === bankId && bank.status === 'verified') ?? null;
}

/**
 * How a drop's files missed the picked verified bank's own readers, each way once: read by the owner's saved layout,
 * or by a built-in layout or standard format the bank's entry does not name. Empty when every file was read by one of
 * its readers, or when the pick is no verified bank.
 */
export function readerMisses(
	bankId: string | null,
	kinds: Iterable<{format: StatementFormat; layout: string | null}>,
	savedLayouts: ReadonlyMap<string, unknown>,
): LayoutMiss[] {
	const bank = verifiedBank(bankId);
	if (!bank) return [];
	const outcomes = new Set<LayoutMissOutcome>();
	for (const {format, layout} of kinds) {
		if (layout !== null && savedLayouts.has(layout)) outcomes.add('saved_layout');
		else if (layout !== null ? !bank.layouts.includes(layout) : !bank.formats.some((own) => own === format)) {
			outcomes.add('other_reader');
		}
	}
	return [...outcomes].map((outcome) => ({outcome, refusalCode: null}));
}

/** Stores the misses of a request that picked a verified bank: its id, each outcome and the time, nothing of a file. */
export async function recordLayoutMisses(
	manager: EntityManager,
	ownerId: Account['id'],
	bankId: string | null,
	misses: readonly LayoutMiss[],
): Promise<void> {
	const bank = verifiedBank(bankId);
	if (!bank || misses.length === 0) return;
	await manager
		.getRepository(BankImportLayoutMiss)
		.insert(misses.map((miss) => ({accountId: ownerId, bankId: bank.id, ...miss})));
}
