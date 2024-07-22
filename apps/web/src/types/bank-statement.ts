import {Account} from './account';
import {File} from './file';
import {Transaction} from './transaction';

export type BankStatement = {
  id: string;
  file: File;
  transactions: Transaction[];
  account: Account;
};
