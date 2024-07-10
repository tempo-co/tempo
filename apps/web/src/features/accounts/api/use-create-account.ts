import {useMutation} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {api} from '@/utils/api';

import {AccountCreateDto} from '../types/account-create.dto';

export const useCreateAccount = () => {
  const {mutate: createAccount, isPending} = useMutation<Account, Error, AccountCreateDto>({
    mutationFn: async (accountCreateDto: AccountCreateDto) => {
      const account = await api.post('/accounts', JSON.stringify(accountCreateDto));
      return account.json();
    },
  });
  return {createAccount, isPending};
};
