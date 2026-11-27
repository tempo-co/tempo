import {useMutation} from '@tanstack/react-query';
import type {CreateBankRequest} from '@tempo/contracts';

import {api} from '@/utils/api';

/** Asks Tempo to read a bank's files: the bank's name, country and file types, never the file itself. */
export function useBankRequest() {
  const {mutateAsync, isPending} = useMutation({
    mutationFn: (request: CreateBankRequest) =>
      api.post<null>('/bank-imports/bank-requests', request satisfies CreateBankRequest),
  });
  return {sendBankRequest: mutateAsync, isPending};
}
