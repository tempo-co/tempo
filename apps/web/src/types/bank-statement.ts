import {BankAccount} from './bank-account';
import {FileEntity} from './file';
import {Transaction} from './transaction';

type Period = {start: Date; end: Date};

export type BankStatement = {
  id: string;
  file: FileEntity;
  transactions: Transaction[];
  bankAccount: BankAccount;
  period: Period;
  uploadedAt: Date;
};

type JobStatus = 'active' | 'completed' | 'failed' | 'waiting';

export type UploadJob = {
  id: string;
  progress: number;
  status: JobStatus;
  failedReason?: string;
  jobId: string;
};
