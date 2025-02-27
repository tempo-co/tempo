import {useMutation, useQueryClient} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {api} from '@/utils/api';

import {AccountCreateDto} from '../types/account-create.dto';

export const useCreateAccount = () => {
  const queryClient = useQueryClient();

  const {mutate: createAccount, isPending} = useMutation<void, Error, AccountCreateDto>({
    mutationFn: async (accountCreateDto: AccountCreateDto) => {
      const response = await api.post('/accounts', JSON.stringify(accountCreateDto));
      const account = (await response.json()) as Account;

      queryClient.setQueryData(['accounts'], (prevAccounts: Account[]) => [
        ...prevAccounts,
        account,
      ]);
    },
  });
  return {createAccount, isPending};
};
