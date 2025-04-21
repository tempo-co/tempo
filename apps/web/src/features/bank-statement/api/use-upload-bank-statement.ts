import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {BankAccount} from '@/types/bank-account';
import {BankStatement} from '@/types/bank-statement';
import {PaginationParams} from '@/types/pagination';
import {HttpError, api} from '@/utils/api';

import {FileState} from '../types/file-state';
import {PaginatedBankStatementsResponse} from './use-get-all-bank-statements';

export const useUploadBankStatement = (
  bankAccountId: BankAccount['id'],
  pagination: PaginationParams,
  setFiles: React.Dispatch<React.SetStateAction<FileState[]>>,
) => {
  const queryClient = useQueryClient();

  const {mutateAsync} = useMutation<BankStatement, HttpError, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const bankStatement = await api.post<BankStatement>(
        `/bank-accounts/${bankAccountId}/bank-statements/upload`,
        formData,
        {headers: {}},
      );

      queryClient.setQueryData<PaginatedBankStatementsResponse>(
        ['bank-statements', pagination, bankAccountId],
        (prevData) => ({
          bankStatements: [...(prevData?.bankStatements ?? []), bankStatement],
          total: (prevData?.total ?? 0) + 1,
        }),
      );
      return bankStatement;
    },
    retry: false,
  });

  const upload = (file: File) => {
    setFiles((prev) => [...prev, {file, isPending: true, error: null, isSuccess: false}]);
    return toast.promise(
      mutateAsync(file)
        .then((bankStatement) => {
          setFiles((prev) =>
            prev.map((fs) =>
              fs.file === file ? {...fs, isPending: false, isSuccess: true, bankStatement} : fs,
            ),
          );
          return bankStatement;
        })
        .catch((error: HttpError) => {
          setFiles((prev) =>
            prev.map((fs) =>
              fs.file === file ? {...fs, isPending: false, error: error.message} : fs,
            ),
          );
          throw error;
        }),
      {
        loading: 'Uploading file...',
        success: 'Bank statement uploaded.',
        error: (error: HttpError) => error.message || 'Error uploading file',
      },
    );
  };

  return {upload};
};
