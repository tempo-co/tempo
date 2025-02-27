import {BankStatement} from '@/types/bank-statement';

export type FileState = {
  file: File;
  isPending: boolean;
  error: string | null;
  isSuccess: boolean;
  bankStatement?: BankStatement;
};
