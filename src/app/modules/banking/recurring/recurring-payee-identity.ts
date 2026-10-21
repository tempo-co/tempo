import {createHash} from 'node:crypto';

import {extractCardMerchantName, extractStructuredCounterpartyName} from '../bank-transaction-display';
import {getBankTransactionMerchantKey} from '../categorization/bank-transaction-merchant-key';
import {parseSepaDescriptionIban} from '../own-transfer/iban';
import type {RecurringCandidate} from './recurring-series-detection';

/** A recurring candidate with the bank's original naming evidence. */
export type RecurringEvidence = RecurringCandidate & {
	description: string | null;
	counterpartyName: string | null;
	transactionType: string | null;
};

const PERSON_TRANSFER_CATEGORIES: ReadonlySet<string> = new Set(['TRANSFER_IN', 'TRANSFER_OUT']);

type PayeeNode = {
	key: string;
	merchantKey: string;
	direction: string;
	currency: string;
	categories: Set<string | null>;
	accounts: Set<string>;
	names: Set<string>;
	/** Compact structured company names, and whether one of them carried a legal form. */
	companies: Map<string, boolean>;
};

/**
 * Gives every candidate the payee identity its own bank evidence supports. Two merchant keys are one payee when the
 * bank declares the same name for both, or the same company in a structured SEPA record written with different
 * spacing. Direction, currency and a single shared payment purpose must also agree. Reads only the given rows.
 */
export function inferRecurringIdentities(rows: readonly RecurringEvidence[]): RecurringCandidate[] {
	const nodes = new Map<string, PayeeNode>();
	for (const row of rows) {
		const key = nodeKey(row);
		const direction = row.merchantKey.slice(0, row.merchantKey.indexOf(':'));
		let node = nodes.get(key);
		if (!node) {
			node = {
				key,
				merchantKey: row.merchantKey,
				direction,
				currency: row.currency,
				categories: new Set(),
				accounts: new Set(),
				names: new Set(),
				companies: new Map(),
			};
			nodes.set(key, node);
		}
		node.categories.add(row.category);
		node.accounts.add(row.bankAccountId);
		for (const name of declaredNames(row)) {
			const normalized = normalizedName(name, direction);
			if (normalized) node.names.add(normalized);
		}
		const company = structuredCompany(row, direction);
		if (company) node.companies.set(company.token, (node.companies.get(company.token) ?? false) || company.legal);
	}

	const parent = new Map([...nodes.keys()].map((key) => [key, key]));
	const find = (key: string): string => {
		while (parent.get(key) !== key) {
			parent.set(key, parent.get(parent.get(key)!)!);
			key = parent.get(key)!;
		}
		return key;
	};
	const connect = (a: PayeeNode, b: PayeeNode) => {
		if (a.currency !== b.currency || a.direction !== b.direction) return;
		// A cross-key link needs one known payment purpose on both sides; one key's history is never split by purpose.
		const [purpose] = a.categories;
		if (a.categories.size !== 1 || b.categories.size !== 1 || purpose === null || !b.categories.has(purpose))
			return;
		const left = find(a.key);
		const right = find(b.key);
		if (left !== right) parent.set(right, left);
	};
	const byName = new Map<string, PayeeNode[]>();
	const byCompany = new Map<string, {node: PayeeNode; legal: boolean}[]>();
	for (const node of nodes.values()) {
		for (const name of node.names) {
			const prior = byName.get(name) ?? [];
			for (const other of prior) connect(other, node);
			prior.push(node);
			byName.set(name, prior);
		}
		for (const [token, legal] of node.companies) {
			const prior = byCompany.get(token) ?? [];
			for (const other of prior) if (legal || other.legal) connect(other.node, node);
			prior.push({node, legal});
			byCompany.set(token, prior);
		}
	}

	const components = new Map<string, PayeeNode[]>();
	for (const node of nodes.values()) {
		const root = find(node.key);
		components.set(root, [...(components.get(root) ?? []), node]);
	}
	const identities = new Map<string, string | undefined>();
	for (const members of components.values()) {
		const memberKeys = members.map(({key}) => key).sort();
		// Only an identity spanning several names or bank accounts needs history reconciliation.
		const identity =
			members.length > 1
				? `${members[0].direction}:automatic-recurring:${createHash('sha256').update(memberKeys.join('\u0000')).digest('hex')}`
				: members[0].accounts.size > 1
					? members[0].merchantKey
					: undefined;
		for (const node of members) identities.set(node.key, identity);
	}
	return rows.map(({description: _description, counterpartyName: _counterparty, transactionType: _type, ...row}) => {
		const recurringPayeeKey = identities.get(nodeKey(row));
		return recurringPayeeKey ? {...row, recurringPayeeKey} : row;
	});
}

function nodeKey({merchantKey, currency}: Pick<RecurringCandidate, 'merchantKey' | 'currency'>): string {
	return `${merchantKey}\u0000${currency}`;
}

/** Names the bank declares for the payee. A card merchant comes first, so a shared acquirer never bridges shops. */
function declaredNames({description, counterpartyName, transactionType, merchantKey}: RecurringEvidence): string[] {
	const text = description?.trim() ?? '';
	const cardName = extractCardMerchantName(text);
	if (cardName) return [cardName];
	const names = [counterpartyName, extractStructuredCounterpartyName(text)].filter((name) => name !== null);
	if (names.length === 0 && transactionType === 'TRANSFER') {
		const pattern = merchantKey.startsWith('EXPENSE:')
			? /^(?:transfer to|to)\s+(.+)$/i
			: /^(?:transfer from|from)\s+(.+)$/i;
		const match = pattern.exec(text);
		if (match) names.push(match[1]);
	}
	return names;
}

/** A company named in a structured SEPA record with an IBAN, compacted so spacing differences still match. */
function structuredCompany(row: RecurringEvidence, direction: string): {token: string; legal: boolean} | null {
	if (!row.counterpartyName || (row.category !== null && PERSON_TRANSFER_CATEGORIES.has(row.category))) return null;
	const description = row.description?.trim() ?? '';
	if (!extractStructuredCounterpartyName(description) || !parseSepaDescriptionIban(description)) return null;
	const normalized = normalizedName(row.counterpartyName, direction);
	if (!normalized) return null;
	// The merchant-key normalizer already knows legal forms; a name it shortened carried one.
	return {token: compact(row.counterpartyName), legal: normalized !== fold(row.counterpartyName)};
}

/** The merchant-key form of a name, so legal forms and processor tails are handled in one place. */
function normalizedName(name: string, direction: string): string | null {
	const key = getBankTransactionMerchantKey({
		counterpartyName: name,
		creditDebitIndicator: direction === 'EXPENSE' ? 'DBIT' : 'CRDT',
	});
	return key ? fold(key.slice(key.indexOf(':') + 1)) : null;
}

function fold(value: string): string {
	return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compact(value: string): string {
	return fold(value).replace(/[^\p{L}\p{N}]/gu, '');
}
