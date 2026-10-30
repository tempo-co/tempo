import {Injectable} from '@nestjs/common';
import {createSign} from 'node:crypto';
import {readFileSync} from 'node:fs';

import {ConfigurationService} from '@core/config/config.service';

import {normalizeBankTransactionLocation} from '../bank-transaction-location';
import {
	EnableBankingAccount,
	EnableBankingAspsp,
	EnableBankingBalance,
	EnableBankingPsuContext,
	EnableBankingSession,
	EnableBankingSessionAccounts,
	EnableBankingTransaction,
	EnableBankingTransactionFetchOptions,
	StartEnableBankingAuthorizationInput,
	StartEnableBankingAuthorizationResult,
} from '../enable-banking.types';
import {normalizeIban, parseSepaDescriptionIban} from '../own-transfer/iban';
import {isValidRetryAfterSeconds} from './banking-sync.constants';

const JWT_TTL_SECONDS = 60 * 60;
const JWT_REFRESH_MARGIN_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TRANSACTION_PAGES = 1_000;

export class EnableBankingClientError extends Error {
	constructor(
		public readonly code: string,
		public readonly providerStatus?: number,
		public readonly retryAfterSeconds?: number,
	) {
		super(code);
		this.name = 'EnableBankingClientError';
	}
}

@Injectable()
export class EnableBankingClient {
	private readonly enabled: boolean;
	private readonly apiUrl: string;
	private readonly applicationId: string;
	private readonly privateKey: string;
	private cachedJwt: {token: string; expiresAt: number} | undefined;

	constructor(config: ConfigurationService) {
		this.enabled = config.get('BANKING_INTEGRATION_ENABLED') !== false;
		if (!this.enabled) {
			this.apiUrl = '';
			this.applicationId = '';
			this.privateKey = '';
			return;
		}

		this.apiUrl = config.get('ENABLE_BANKING_API_URL').replace(/\/$/, '');
		this.applicationId = config.get('ENABLE_BANKING_APPLICATION_ID');
		const privateKeyPath = config.get('ENABLE_BANKING_PRIVATE_KEY_PATH');
		const privateKeyB64 = config.get('ENABLE_BANKING_PRIVATE_KEY_B64');
		this.privateKey = privateKeyPath
			? readFileSync(privateKeyPath, 'utf8')
			: Buffer.from(privateKeyB64 as string, 'base64').toString('utf8');
	}

	async getAspsps(country?: string, signal?: AbortSignal): Promise<EnableBankingAspsp[]> {
		const filteredParams = new URLSearchParams({psu_type: 'personal', service: 'AIS'});
		if (country) filteredParams.set('country', country);

		try {
			const response = await this.request(`/aspsps?${filteredParams.toString()}`, undefined, signal);
			return this.parseAspsps(response);
		} catch (error) {
			if (!this.isUnsupportedAspspFilterError(error)) throw error;

			const fallbackParams = new URLSearchParams();
			if (country) fallbackParams.set('country', country);
			const query = fallbackParams.toString();
			const response = await this.request(`/aspsps${query ? `?${query}` : ''}`, undefined, signal);
			return this.parseAspsps(response);
		}
	}

	async startAuthorization(
		input: StartEnableBankingAuthorizationInput,
	): Promise<StartEnableBankingAuthorizationResult> {
		const response = await this.request('/auth', {
			access: {
				balances: true,
				transactions: true,
				valid_until: input.validUntil,
			},
			aspsp: input.aspsp,
			state: input.state,
			redirect_url: input.redirectUrl,
			psu_type: 'personal',
			psu_id: input.psuId,
		});

		const record = this.asRecord(response);
		const url = this.asString(record?.url);
		const authorizationId = this.asString(record?.authorization_id);

		if (!url || !authorizationId) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		return {url, authorizationId};
	}

	async createSession(code: string): Promise<EnableBankingSession> {
		const response = await this.request('/sessions', {code});
		const record = this.asRecord(response);
		const sessionId = this.asString(record?.session_id);
		const consentValidUntil = this.asString(this.asRecord(record?.access)?.valid_until);
		const aspspRecord = this.asRecord(record?.aspsp);
		const aspspName = this.asString(aspspRecord?.name);
		const aspspCountry = this.asString(aspspRecord?.country);
		const rawAccounts = record?.accounts;

		if (!sessionId || !consentValidUntil || !aspspName || !aspspCountry || !Array.isArray(rawAccounts)) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		const accounts = rawAccounts.flatMap((rawAccount) => this.parseAccount(rawAccount));

		return {
			sessionId,
			consentValidUntil,
			aspsp: {name: aspspName, country: aspspCountry},
			accounts,
		};
	}

	async getSessionAccounts(
		sessionId: string,
		signal?: AbortSignal,
		psu?: EnableBankingPsuContext,
	): Promise<EnableBankingSessionAccounts> {
		const response = await this.request(`/sessions/${encodeURIComponent(sessionId)}`, undefined, signal, psu);
		const record = this.asRecord(response);
		const status = this.asString(record?.status);
		const rawAccounts = record?.accounts;

		if (
			!status ||
			!Array.isArray(rawAccounts) ||
			rawAccounts.some((accountId) => typeof accountId !== 'string' || accountId.length === 0)
		) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		return {status, accountIds: rawAccounts as string[]};
	}

	async getAccountBalances(
		accountId: string,
		signal?: AbortSignal,
		psu?: EnableBankingPsuContext,
	): Promise<EnableBankingBalance[]> {
		const response = await this.request(
			`/accounts/${encodeURIComponent(accountId)}/balances`,
			undefined,
			signal,
			psu,
		);
		return this.parseBalances(response);
	}

	async getAccountTransactions(
		accountId: string,
		options: EnableBankingTransactionFetchOptions,
		signal?: AbortSignal,
		psu?: EnableBankingPsuContext,
	): Promise<EnableBankingTransaction[]> {
		const transactions: EnableBankingTransaction[] = [];
		let continuationKey: string | undefined;

		for (let page = 0; page < MAX_TRANSACTION_PAGES; page += 1) {
			const params = new URLSearchParams({strategy: options.strategy});
			if (options.dateFrom) params.set('date_from', options.dateFrom);
			if (options.dateTo) params.set('date_to', options.dateTo);
			if (continuationKey) params.set('continuation_key', continuationKey);

			const response = await this.request(
				`/accounts/${encodeURIComponent(accountId)}/transactions?${params.toString()}`,
				undefined,
				signal,
				psu,
			);
			const parsed = this.parseTransactionsPage(response);
			transactions.push(...parsed.transactions);

			if (!parsed.continuationKey) return transactions;
			continuationKey = parsed.continuationKey;
		}

		throw new EnableBankingClientError('provider_pagination_limit_exceeded');
	}

	private async request(
		path: string,
		body?: Record<string, unknown>,
		signal?: AbortSignal,
		psu?: EnableBankingPsuContext,
	): Promise<unknown> {
		if (!this.enabled) throw new EnableBankingClientError('banking_integration_disabled');

		let response: Response;
		const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

		try {
			requestSignal.throwIfAborted();
			response = await fetch(`${this.apiUrl}${path}`, {
				method: body ? 'POST' : 'GET',
				headers: {
					Accept: 'application/json',
					...(psu ? {'Psu-Ip-Address': psu.ipAddress} : {}),
					...(psu?.userAgent ? {'Psu-User-Agent': psu.userAgent} : {}),
					...(body ? {'Content-Type': 'application/json'} : {}),
					Authorization: `Bearer ${this.createJwt()}`,
				},
				...(body ? {body: JSON.stringify(body)} : {}),
				signal: requestSignal,
			});
		} catch {
			throw new EnableBankingClientError('provider_unreachable');
		}

		const responseBytes = Buffer.from(await response.arrayBuffer());
		const retryAfterSeconds = this.parseRetryAfter(response.headers.get('retry-after'));
		const responseText = this.decodeBodyText(responseBytes, response.headers.get('content-type'));
		let responseBody: unknown;

		if (responseText) {
			try {
				responseBody = JSON.parse(responseText) as unknown;
			} catch {
				throw new EnableBankingClientError('invalid_provider_response', response.status, retryAfterSeconds);
			}
		}

		if (!response.ok) {
			throw new EnableBankingClientError(
				this.extractProviderErrorCode(responseBody),
				response.status,
				retryAfterSeconds,
			);
		}

		return responseBody;
	}

	private createJwt(): string {
		const issuedAt = Math.floor(Date.now() / 1000);
		if (this.cachedJwt && this.cachedJwt.expiresAt - issuedAt > JWT_REFRESH_MARGIN_SECONDS) {
			return this.cachedJwt.token;
		}

		const expiresAt = issuedAt + JWT_TTL_SECONDS;
		const header = this.base64UrlEncode({typ: 'JWT', alg: 'RS256', kid: this.applicationId});
		const payload = this.base64UrlEncode({
			iss: 'enablebanking.com',
			aud: 'api.enablebanking.com',
			iat: issuedAt,
			exp: expiresAt,
		});
		const unsignedToken = `${header}.${payload}`;

		try {
			const signer = createSign('RSA-SHA256');
			signer.update(unsignedToken);
			signer.end();
			const signature = signer.sign(this.privateKey).toString('base64url');
			const token = `${unsignedToken}.${signature}`;
			this.cachedJwt = {token, expiresAt};
			return token;
		} catch {
			throw new EnableBankingClientError('provider_authentication_failed');
		}
	}

	private parseAspsps(response: unknown): EnableBankingAspsp[] {
		const rawAspsps = this.asRecord(response)?.aspsps;

		if (!Array.isArray(rawAspsps)) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		const aspsps = rawAspsps.flatMap((rawAspsp) => {
			const record = this.asRecord(rawAspsp);
			const name = this.asString(record?.name);
			const country = this.asString(record?.country);
			const logoUrl = this.asHttpsUrl(record?.logo);
			const maximumConsentValiditySeconds = record?.maximum_consent_validity;

			if (
				!name ||
				!country ||
				typeof maximumConsentValiditySeconds !== 'number' ||
				!Number.isFinite(maximumConsentValiditySeconds) ||
				maximumConsentValiditySeconds <= 0
			) {
				return [];
			}

			const requiredPsuHeaders = record?.required_psu_headers;
			if (
				requiredPsuHeaders !== undefined &&
				(!Array.isArray(requiredPsuHeaders) ||
					requiredPsuHeaders.some((header) => typeof header !== 'string' || !header.trim()))
			) {
				throw new EnableBankingClientError('invalid_provider_response');
			}
			return [
				{
					name,
					country,
					...(logoUrl ? {logoUrl} : {}),
					maximumConsentValiditySeconds,
					...(requiredPsuHeaders !== undefined ? {requiredPsuHeaders: requiredPsuHeaders as string[]} : {}),
				},
			];
		});

		if (rawAspsps.length > 0 && aspsps.length === 0) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		return aspsps;
	}

	private parseAccount(rawAccount: unknown): EnableBankingAccount[] {
		const record = this.asRecord(rawAccount);
		const identificationHash = this.asString(record?.identification_hash);
		const currency = this.asString(record?.currency);
		const iban = normalizeIban(this.asString(this.asRecord(record?.account_id)?.iban));

		if (!identificationHash || !currency || currency.length !== 3) {
			return [];
		}

		return [
			{
				uid: this.asString(record?.uid),
				identificationHash,
				...(iban ? {iban} : {}),
				name: this.asOptionalString(record?.name),
				details: this.asOptionalString(record?.details),
				currency,
				cashAccountType: this.asOptionalString(record?.cash_account_type),
				usage: this.asOptionalString(record?.usage),
			},
		];
	}

	private parseBalances(response: unknown): EnableBankingBalance[] {
		const rawBalances = this.asRecord(response)?.balances;
		if (!Array.isArray(rawBalances)) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		const balances = rawBalances.flatMap((rawBalance) => {
			const record = this.asRecord(rawBalance);
			const amountRecord = this.asRecord(record?.balance_amount);
			const amount = this.asAmount(amountRecord?.amount);
			const currency = this.asString(amountRecord?.currency);

			if (!amount || !currency || currency.length !== 3) return [];

			return [
				{
					name: this.asOptionalString(record?.name),
					balanceType: this.asString(record?.balance_type) ?? 'UNKNOWN',
					amount,
					currency: currency.toUpperCase(),
					lastChangeDateTime: this.asOptionalString(record?.last_change_date_time),
					referenceDate: this.asOptionalString(record?.reference_date),
					lastCommittedTransaction: this.asOptionalString(record?.last_committed_transaction),
				},
			];
		});

		if (rawBalances.length > 0 && balances.length === 0) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		return balances;
	}

	private parseTransactionsPage(response: unknown): {
		transactions: EnableBankingTransaction[];
		continuationKey?: string;
	} {
		const record = this.asRecord(response);
		const rawTransactions = record?.transactions;
		if (!Array.isArray(rawTransactions)) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		const transactions = rawTransactions.flatMap((rawTransaction) => this.parseTransaction(rawTransaction));
		if (rawTransactions.length > 0 && transactions.length === 0) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		const rawContinuationKey = record?.continuation_key;
		if (rawContinuationKey !== undefined && rawContinuationKey !== null && typeof rawContinuationKey !== 'string') {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		return {
			transactions,
			continuationKey: this.asOptionalString(rawContinuationKey),
		};
	}

	private parseTransaction(rawTransaction: unknown): EnableBankingTransaction[] {
		const record = this.asRecord(rawTransaction);
		const amountRecord = this.asRecord(record?.transaction_amount);
		const amount = this.asAmount(amountRecord?.amount);
		const currency = this.asCurrency(amountRecord?.currency);
		if (!amount || !currency) return [];

		const creditDebitIndicator = this.asOptionalString(record?.credit_debit_indicator)?.toUpperCase();
		const creditor = this.asRecord(record?.creditor);
		const debtor = this.asRecord(record?.debtor);
		const creditorName = this.asString(creditor?.name);
		const debtorName = this.asString(debtor?.name);
		const counterparty =
			creditDebitIndicator === 'DBIT' ? creditor : creditDebitIndicator === 'CRDT' ? debtor : undefined;
		const counterpartyName =
			creditDebitIndicator === 'CRDT' ? (debtorName ?? creditorName) : (creditorName ?? debtorName);
		const counterpartyLocation = this.parseCounterpartyLocation(counterparty);
		const remittanceInformation = this.parseRemittanceInformation(record?.remittance_information);
		const counterpartyAccount =
			creditDebitIndicator === 'DBIT'
				? record?.creditor_account
				: creditDebitIndicator === 'CRDT'
					? record?.debtor_account
					: undefined;
		const bankTransactionCode = this.asRecord(record?.bank_transaction_code);
		const balanceAfter = this.parseAmountAndCurrency(record?.balance_after_transaction);
		const exchangeRate = this.asRecord(record?.exchange_rate);
		const instructedAmount = this.parseAmountAndCurrency(exchangeRate?.instructed_amount);
		const description =
			this.asOptionalString(record?.note) ??
			remittanceInformation ??
			this.asString(bankTransactionCode?.description) ??
			counterpartyName;
		const counterpartyIban =
			normalizeIban(this.asString(this.asRecord(counterpartyAccount)?.iban)) ??
			parseSepaDescriptionIban(description);

		return [
			{
				providerTransactionId: this.asOptionalString(record?.transaction_id),
				entryReference: this.asOptionalString(record?.entry_reference),
				merchantCategoryCode: this.asOptionalString(record?.merchant_category_code),
				amount,
				currency,
				creditDebitIndicator,
				status: this.asOptionalString(record?.status),
				transactionDate: this.asOptionalString(record?.transaction_date),
				bookingDate:
					this.asOptionalString(record?.booking_date) ?? this.asOptionalString(record?.transaction_date),
				valueDate: this.asOptionalString(record?.value_date) ?? this.asOptionalString(record?.transaction_date),
				description,
				counterpartyName,
				...(counterpartyIban ? {counterpartyIban} : {}),
				...(counterpartyLocation ? {counterpartyLocation} : {}),
				remittanceInformation,
				bankTransactionCode: this.asOptionalString(bankTransactionCode?.code),
				bankTransactionSubCode: this.asOptionalString(bankTransactionCode?.sub_code),
				bankTransactionDescription: this.asOptionalString(bankTransactionCode?.description),
				balanceAfterAmount: balanceAfter.amount,
				balanceAfterCurrency: balanceAfter.currency,
				instructedAmount: instructedAmount.amount,
				instructedCurrency: instructedAmount.currency,
				exchangeRate: this.asAmount(exchangeRate?.exchange_rate),
				exchangeRateUnitCurrency: this.asCurrency(exchangeRate?.unit_currency),
				exchangeRateType: this.asOptionalString(exchangeRate?.rate_type),
				referenceNumber: this.asOptionalString(record?.reference_number),
				referenceNumberScheme: this.asOptionalString(record?.reference_number_schema),
			},
		];
	}

	private parseCounterpartyLocation(counterparty: Record<string, unknown> | undefined) {
		const postalAddress = this.asRecord(counterparty?.postal_address);
		return normalizeBankTransactionLocation({
			city: postalAddress?.town_name,
			region: postalAddress?.country_sub_division,
			country: postalAddress?.country,
		});
	}

	private decodeBodyText(bytes: Buffer, contentType: string | null): string {
		try {
			// Some ASPSP feeds declare a legacy charset while emitting UTF-8 bytes; valid UTF-8 always wins.
			return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
		} catch {
			// Not valid UTF-8: honor the declared charset, otherwise assume the common Latin-1 superset.
		}

		const declaredCharset = contentType
			?.toLowerCase()
			.match(/charset=([^\s;]+)/)?.[1]
			?.replace(/"/g, '');

		if (declaredCharset && !/^utf-?8$/i.test(declaredCharset)) {
			try {
				return new TextDecoder(declaredCharset).decode(bytes);
			} catch {
				// Unknown declared charset: continue with the default legacy charset.
			}
		}

		return new TextDecoder('windows-1252').decode(bytes);
	}

	private parseRemittanceInformation(value: unknown): string | undefined {
		if (Array.isArray(value)) {
			const lines = value.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
			return lines.length > 0 ? lines.join(' ').trim() : undefined;
		}

		return this.asOptionalString(value)?.trim() || undefined;
	}

	private extractProviderErrorCode(response: unknown): string {
		const record = this.asRecord(response);

		for (const key of ['error', 'error_code', 'code']) {
			const value = this.asString(record?.[key]);
			if (value) return value.slice(0, 100);
		}

		return 'provider_request_failed';
	}

	private parseRetryAfter(value: string | null): number | undefined {
		if (!value) return undefined;

		if (/^\d+$/.test(value)) {
			const seconds = Number(value);
			return isValidRetryAfterSeconds(seconds) ? seconds : undefined;
		}

		const retryAt = Date.parse(value);
		if (Number.isNaN(retryAt)) return undefined;

		return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
	}

	private isUnsupportedAspspFilterError(error: unknown): boolean {
		if (
			!(error instanceof EnableBankingClientError) ||
			(error.providerStatus !== 400 && error.providerStatus !== 422)
		) {
			return false;
		}

		const normalizedCode = error.code
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, '_');
		return (
			normalizedCode === 'wrong_request_parameters' ||
			/^(?:unsupported|unknown|unrecognized|invalid)_(?:query_)?(?:parameter|filter)s?$/.test(normalizedCode)
		);
	}

	private asHttpsUrl(value: unknown): string | undefined {
		const url = this.asString(value);
		if (!url) return undefined;

		try {
			return new URL(url).protocol === 'https:' ? url : undefined;
		} catch {
			return undefined;
		}
	}

	private asRecord(value: unknown): Record<string, unknown> | undefined {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	}

	private asString(value: unknown): string | undefined {
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	}

	private asOptionalString(value: unknown): string | undefined {
		return typeof value === 'string' ? value : undefined;
	}

	private asCurrency(value: unknown): string | undefined {
		const currency = this.asString(value)?.toUpperCase();
		return currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined;
	}

	private parseAmountAndCurrency(value: unknown): {amount?: string; currency?: string} {
		const record = this.asRecord(value);
		const amount = this.asAmount(record?.amount);
		const currency = this.asCurrency(record?.currency);
		return amount && currency ? {amount, currency} : {};
	}

	private asAmount(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const amount = value.trim();
		return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(amount) ? amount : undefined;
	}

	private base64UrlEncode(value: Record<string, unknown>): string {
		return Buffer.from(JSON.stringify(value)).toString('base64url');
	}
}
