export const BANK_CONNECTION_RESULTS = ['connected', 'cancelled', 'error'] as const;
export type BankConnectionResult = (typeof BANK_CONNECTION_RESULTS)[number];

export const BANK_CONNECTION_RESULT_CHANNEL = 'tempo-bank-connection-result';

const BANK_CONNECTION_RESULT_MESSAGE = 'bank-connection-result';

type BankConnectionResultMessage = {
  type: typeof BANK_CONNECTION_RESULT_MESSAGE;
  result: BankConnectionResult;
};

export const createBankConnectionResultMessage = (
  result: BankConnectionResult,
): BankConnectionResultMessage => ({
  type: BANK_CONNECTION_RESULT_MESSAGE,
  result,
});

const isBankConnectionResult = (value: unknown): value is BankConnectionResult =>
  BANK_CONNECTION_RESULTS.some((result) => result === value);

export const isBankConnectionResultMessage = (
  value: unknown,
): value is BankConnectionResultMessage => {
  if (typeof value !== 'object' || value === null) return false;

  const message = value as Partial<BankConnectionResultMessage>;
  return message.type === BANK_CONNECTION_RESULT_MESSAGE && isBankConnectionResult(message.result);
};
