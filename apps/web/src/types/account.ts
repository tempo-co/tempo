import {Bank} from './bank';
import {User} from './user';

export type Account = {
  id: string;
  alias: string | null;
  balance: number;
  bank: Bank;
  user: User;
};
