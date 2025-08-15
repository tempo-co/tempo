import {Bank} from './bank';

export type BankAccount = {
  id: string;
  alias: string | null;
  balance: number;
  bank: Bank;
  currency: string;
  transactionsCount?: number;
};
