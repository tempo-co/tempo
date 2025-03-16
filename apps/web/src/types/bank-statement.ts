import {BankAccount} from './bank-account';
import {File} from './file';
import {Transaction} from './transaction';

type Period = {start: Date; end: Date};

export type BankStatement = {
  id: string;
  file: File;
  transactions: Transaction[];
  bankAccount: BankAccount;
  period: Period;
  uploadedAt: Date;
};
