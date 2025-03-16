import {useMutation, useQueryClient} from '@tanstack/react-query';

import {BankAccount} from '@/types/bank-account';
import {api} from '@/utils/api';

import {BankAccountCreateDto} from '../types/bank-account-create.dto';

export const useCreateBankAccount = () => {
  const queryClient = useQueryClient();

  const {mutateAsync: createBankAccount, isPending} = useMutation<
    void,
    Error,
    BankAccountCreateDto
  >({
    mutationFn: async (dto: BankAccountCreateDto) => {
      const response = await api.post('/bank-accounts', JSON.stringify(dto));
      const bankAccount = (await response.json()) as BankAccount;

      queryClient.setQueryData(['bank-accounts'], (prevBankAccounts: BankAccount[]) => [
        ...prevBankAccounts,
        bankAccount,
      ]);
    },
    retry: false,
  });
  return {createBankAccount, isPending};
};
