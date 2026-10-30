type BankAccountLabelParts = {bankName: string; currency: string};

export function bankAccountLabelKey({bankName, currency}: BankAccountLabelParts) {
  return `${bankName}|${currency}`;
}

export function formatBankAccountLabel({bankName, currency}: BankAccountLabelParts) {
  return `${bankName} · ${currency}`;
}

/** Keys of bank-and-currency pairs shared by more than one account, which need the account name too. */
export function findAmbiguousBankAccountKeys(accounts: BankAccountLabelParts[]) {
  const counts = new Map<string, number>();
  accounts.forEach((account) => {
    const key = bankAccountLabelKey(account);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}
