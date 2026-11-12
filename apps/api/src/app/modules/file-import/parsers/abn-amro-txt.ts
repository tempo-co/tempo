import {abnAmroDescriptionFields, abnAmroIban} from './abn-amro';
import {checkedDate} from './dates';
import {amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';

const COLUMNS = 8;
const CURRENCY = /^[A-Z]{3}$/;
const AMOUNT = /^[+-]?\d{1,15},\d{2}$/;

/** Every line is 8 tab-separated columns: an account number, then a currency and a `YYYYMMDD` date. */
export function looksLikeAbnAmroTxt(bytes: Uint8Array): boolean {
	const lines = linesOf(bytes);
	return (
		lines.length > 0 &&
		lines.every((line) => {
			const columns = line.split('\t');
			return columns.length === COLUMNS && /^\d+$/.test(columns[0]) && /^\d{8}$/.test(columns[2]);
		})
	);
}

/**
 * Reads ABN AMRO's TXT export (latin-1, tab-separated, no header, oldest first): account number, currency, date,
 * balance before, balance after, date again, amount, description. One statement per account and currency, in the
 * order the file first names them. Each row's balances must add up.
 */
export function parseAbnAmroTxt(bytes: Uint8Array): NormalizedStatement[] {
	const statements = new Map<string, NormalizedStatement>();
	for (const line of linesOf(bytes)) {
		const [account, currency, bookingDay, before, after, valueDay, amount, text] = line.split('\t');
		const iban = abnAmroIban(account);
		const [balanceBefore, balanceAfter, change] = [before, after, amount].map((value) =>
			AMOUNT.test(value) ? parseDecimal(value, ',') : null,
		);
		if (!iban || !CURRENCY.test(currency) || !balanceBefore || !balanceAfter || !change) {
			throw new ParseRefusal('parse_failed');
		}
		if (balanceBefore.units + change.units !== balanceAfter.units) throw new ParseRefusal('parse_failed');

		const key = JSON.stringify([iban, currency]);
		const statement: NormalizedStatement = statements.get(key) ?? {
			format: 'abnAmroTxt',
			accountIban: iban,
			accountOtherId: null,
			bank: null,
			accountCurrency: currency,
			sequenceNumber: null,
			entriesSkipped: 0,
			rows: [],
		};
		statements.set(key, statement);
		const description = text.trimEnd();
		const fields = abnAmroDescriptionFields(description);
		const row: NormalizedRow = {
			bookingDate: compactDate(bookingDay),
			valueDate: compactDate(valueDay),
			transactionDate: null,
			amount: formatUnits(change.units, amountScale(change)),
			creditDebitIndicator: change.units > 0n ? 'CRDT' : 'DBIT',
			currency,
			balanceAfter: formatUnits(balanceAfter.units, amountScale(balanceAfter)),
			bankReference: null,
			counterpartyName: fields.counterpartyName,
			counterpartyIban: fields.counterpartyIban,
			remittanceInformation: fields.remittanceInformation,
			description: description || null,
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			referenceNumber: fields.referenceNumber,
		};
		statement.rows.push(row);
	}
	return [...statements.values()];
}

function linesOf(bytes: Uint8Array): string[] {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		.toString('latin1')
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
}

/** `YYYYMMDD` as `YYYY-MM-DD`. */
function compactDate(value: string): string {
	return checkedDate(/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : '');
}
