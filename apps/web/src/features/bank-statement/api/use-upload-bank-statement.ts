import {useMutation, useQueryClient} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {HttpError, api} from '@/utils/api';

import {FileState} from '../types/file-state';
import {PaginatedBankStatementsResponse} from './use-get-all-bank-statements';

type UploadBankStatementHttpError = HttpError & {
  status: 400 | 401 | 409 | 422;
};

export const useUploadBankStatement = (
  accountId: Account['id'],
  pagination: PaginationState,
  setFiles: React.Dispatch<React.SetStateAction<FileState[]>>,
) => {
  const queryClient = useQueryClient();

  const {mutateAsync} = useMutation<BankStatement, UploadBankStatementHttpError, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post(`/accounts/${accountId}/bank-statements/upload`, formData, {
        headers: {},
      });
      const bankStatement = (await response.json()) as BankStatement;

      queryClient.setQueryData(
        ['bank-statements', pagination, accountId],
        (prevData: PaginatedBankStatementsResponse) => ({
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
        .catch((error: UploadBankStatementHttpError) => {
          setFiles((prev) =>
            prev.map((fs) =>
              fs.file === file ? {...fs, isPending: false, error: error.message} : fs,
            ),
          );
          throw error;
        }),
      {
        loading: 'Uploading file...',
        success: 'Bank statement uploaded successfully',
        error: (error: UploadBankStatementHttpError) => error.message || 'Error uploading file',
      },
    );
  };

  return {upload};
};
