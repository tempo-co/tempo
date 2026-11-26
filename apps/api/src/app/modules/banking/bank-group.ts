import {BANK_CONNECTION_PROVIDERS} from './services/banking-sync.constants';

/** The accounts one bank reports together; null for an imported account that records no bank. */
export type BankGroup = string | null;

/**
 * The accounts one bank reports together. A bank connection's accounts form one group. The imported-files connection
 * holds the files of every bank, so there accounts group by the bank they record, and an account that records none
 * joins no group (null).
 */
export function bankGroupOf({
	connectionId,
	provider,
	bankIdentity,
}: {
	connectionId: string;
	provider: string;
	bankIdentity: string | null;
}): BankGroup {
	if (provider !== BANK_CONNECTION_PROVIDERS.FILE) return connectionId;
	return bankIdentity === null ? null : `${connectionId}:${bankIdentity}`;
}
