import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  BankImportLayout,
  BankImportLayoutProposal,
  ConfirmBankImportLayoutProposalRequest,
} from '@tempo/contracts';

import {api} from '@/utils/api';

import {bankImportQueryKeys} from './use-bank-imports';

/**
 * Works out the columns of one file Tempo does not know: one model call on a masked sample, then the whole file is
 * read with the answer. Up to half a minute; `signal` cancels the wait (the owner's daily count is spent anyway).
 */
export function useProposeLayout() {
  const {mutateAsync} = useMutation({
    mutationFn: ({file, signal}: {file: File; signal: AbortSignal}) => {
      const form = new FormData();
      form.append('files', file);
      return api.post<BankImportLayoutProposal>('/bank-imports/layout-proposals', form, {signal});
    },
  });
  return {proposeLayout: mutateAsync};
}

/** Saves a proposal as the owner's layout; their next drop of the file reads with it. */
export function useConfirmLayout() {
  const queryClient = useQueryClient();
  const {mutateAsync} = useMutation({
    mutationFn: ({
      proposalId,
      ...request
    }: ConfirmBankImportLayoutProposalRequest & {proposalId: string}) =>
      api.post<BankImportLayout>(`/bank-imports/layout-proposals/${proposalId}/confirm`, request),
    onSuccess: () => queryClient.invalidateQueries({queryKey: bankImportQueryKeys.layouts}),
  });
  return {confirmLayout: mutateAsync};
}

/** Discards a proposal the owner said is not right. */
export function useRejectLayout() {
  const {mutateAsync} = useMutation({
    mutationFn: (proposalId: string) =>
      api.post<null>(`/bank-imports/layout-proposals/${proposalId}/reject`),
  });
  return {rejectLayout: mutateAsync};
}

export const bankImportLayoutsQueryOptions = queryOptions({
  queryKey: bankImportQueryKeys.layouts,
  queryFn: () => api.get<BankImportLayout[]>('/bank-imports/layouts'),
});

/** The layouts the owner confirmed, newest first. */
export function useBankImportLayouts(enabled: boolean) {
  return useQuery({...bankImportLayoutsQueryOptions, enabled});
}

/** Removes a saved layout; what it imported stays. */
export function useRemoveLayout() {
  const queryClient = useQueryClient();
  const {mutateAsync} = useMutation({
    mutationFn: (layoutId: string) => api.delete<null>(`/bank-imports/layouts/${layoutId}`),
    onSuccess: (_, layoutId) =>
      queryClient.setQueryData<BankImportLayout[]>(bankImportQueryKeys.layouts, (layouts) =>
        layouts?.filter(({id}) => id !== layoutId),
      ),
    onSettled: () => queryClient.invalidateQueries({queryKey: bankImportQueryKeys.layouts}),
  });
  return {removeLayout: mutateAsync};
}
