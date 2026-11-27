import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  BankImportLayout,
  BankImportLayoutProposal,
  ConfirmBankImportLayoutProposalRequest,
} from '@wisp/contracts';

import {api} from '@/utils/api';

import type {PickedBankId} from '../utils/picked-bank';
import {bankImportQueryKeys} from './use-bank-imports';

/**
 * Works out the columns of one file Wisp does not know: one model call on a masked sample, then the whole file is
 * read with the answer. Up to half a minute; `signal` cancels the wait (the owner's daily count is spent anyway).
 */
export function useProposeLayout() {
  const {mutateAsync} = useMutation({
    mutationFn: ({
      file,
      bankId,
      signal,
    }: {
      file: File;
      /** The bank the owner picked for the drop (`BankImportPickedBank`), when they picked one. */
      bankId: PickedBankId;
      signal: AbortSignal;
    }) => {
      const form = new FormData();
      form.append('files', file);
      if (bankId) form.append('bankId', bankId);
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
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({queryKey: bankImportQueryKeys.layouts}),
        // Later proposals read their banks afresh; the saved one's list is never read again.
        queryClient.invalidateQueries({queryKey: bankImportQueryKeys.banks, refetchType: 'none'}),
      ]),
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
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({queryKey: bankImportQueryKeys.layouts}),
        queryClient.invalidateQueries({queryKey: bankImportQueryKeys.banks}),
      ]),
  });
  return {removeLayout: mutateAsync};
}
