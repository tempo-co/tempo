// useUploadBankStatement.ts
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import prettyBytes from 'pretty-bytes';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

import {FileState} from '../components/bank-statement-upload-dialog';
import {formatFileType} from '../utils/format-file-type';
import {truncateFileName} from '../utils/truncate-file-name';
import {PaginatedBankStatementsResponse} from './use-get-all-bank-statements';

export const useUploadBankStatement = (
  accountId: Account['id'],
  pagination: PaginationState,
  setFiles: React.Dispatch<React.SetStateAction<FileState[]>>,
) => {
  const queryClient = useQueryClient();

  const {mutateAsync} = useMutation<BankStatement, Error, File>({
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
    setFiles((prev) => [...prev, {file, isPending: true, isError: false, isSuccess: false}]);
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
        .catch((error) => {
          setFiles((prev) =>
            prev.map((fs) => (fs.file === file ? {...fs, isPending: false, isError: true} : fs)),
          );
          throw error;
        }),
      {
        loading: 'Uploading file...',
        success: 'Bank statement uploaded successfully',
        error: 'Error uploading file',
        description: `${formatFileType(file.type)} • ${prettyBytes(Number(file.size))} • ${truncateFileName(file.name, 30)}`,
      },
    );
  };

  return {upload};
};
