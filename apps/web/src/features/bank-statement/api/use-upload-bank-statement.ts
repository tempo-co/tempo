import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useUploads} from '@/hooks/use-uploads';
import {BankAccount} from '@/types/bank-account';
import {UploadJob} from '@/types/bank-statement';
import {HttpError, api} from '@/utils/api';

export const useUploadBankStatement = (bankAccountId: BankAccount['id']) => {
  const {addUploadingFile} = useUploads();

  return useMutation<UploadJob, HttpError, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post<UploadJob>(
        `/bank-accounts/${bankAccountId}/bank-statements/upload`,
        formData,
        {headers: {}},
      );
    },
    onSuccess: (data, file) => {
      const fileId = `${file.name}-${file.lastModified}`;
      addUploadingFile({id: fileId, file, jobId: data.jobId, bankAccountId});
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start upload.');
    },
  });
};
