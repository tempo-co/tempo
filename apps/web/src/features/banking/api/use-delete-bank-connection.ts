import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {BankConnectionRemoveRequest} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {HttpError, api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

export const DELETE_BANK_CONNECTION_KEY = ['delete-bank-connection'];

export const useDeleteBankConnection = () => {
  const queryClient = useQueryClient();

  const {mutateAsync: deleteMutation, isPending} = useMutation<
    void,
    HttpError,
    {connectionId: string} & BankConnectionRemoveRequest
  >({
    mutationKey: DELETE_BANK_CONNECTION_KEY,
    mutationFn: async ({connectionId, ...body}) => {
      await api.delete<void>(
        `/bank-connections/${connectionId}`,
        Object.keys(body).length > 0 ? (body satisfies BankConnectionRemoveRequest) : undefined,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: bankQueryKeys.connections}),
        queryClient.invalidateQueries({queryKey: dashboardQueryKeys.root}),
        // Removing a bank can settle or change the currency totals use.
        queryClient.invalidateQueries({queryKey: bankQueryKeys.reportingCurrency}),
      ]);
    },
  });

  const deleteBankConnection = (connectionId: string, removal: BankConnectionRemoveRequest = {}) =>
    deleteMutation({connectionId, ...removal});

  return {deleteBankConnection, isPending};
};
