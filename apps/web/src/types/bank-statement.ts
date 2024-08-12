import {Account} from './account';
import {File} from './file';
import {Transaction} from './transaction';

type Period = {start: Date; end: Date} | null;

export type BankStatement = {
  id: string;
  file: File;
  transactions: Transaction[];
  account: Account;
  period: Period;
  uploadedAt: Date;
};
