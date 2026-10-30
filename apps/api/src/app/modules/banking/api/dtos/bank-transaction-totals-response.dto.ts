/** Totals over all filtered rows. Money is expressed as decimal base-currency strings. */
export class BankTransactionTotalsResponseDto {
	baseCurrency: string | null;
	spending: string;
	income: string;
	net: string;
	count: number;
	excluded: {unknownDirection: number; missingBaseAmount: number};
}
