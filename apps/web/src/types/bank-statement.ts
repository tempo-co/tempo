import {Account} from './account';
import {Transaction} from './transaction';

export type BankStatement = {
  id: string;
  file: Buffer;
  account: Account;
  transactions: Transaction[];
};
