import {Bank} from './bank';

export type Account = {
  id: string;
  alias: string | null;
  balance: number;
  bank: Bank;
};
