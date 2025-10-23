import {useQuery} from '@tanstack/react-query';

import {UploadJob} from '@/types/bank-statement';
import {HttpError, api} from '@/utils/api';

const POLLING_INTERVAL_MS = 1000;

export const useGetUploadStatus = (bankAccountId: string, jobId: string | null) => {
  const {data, isError, error} = useQuery<UploadJob, HttpError>({
    queryKey: ['upload-status', jobId, bankAccountId],
    queryFn: async () => {
      return api.get<UploadJob>(
        `/bank-accounts/${bankAccountId}/bank-statements/upload/status/${jobId}`,
      );
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed' || query.state.error) {
        return false;
      }
      return POLLING_INTERVAL_MS;
    },
    retry: (failureCount, error) => {
      if (error.status === 404) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return {job: data, isError, error};
};
