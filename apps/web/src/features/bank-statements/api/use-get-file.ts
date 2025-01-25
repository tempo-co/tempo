import {useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {MimeType, getMimeTypeKey} from '@/types/mime-type';
import {api} from '@/utils/api';

import {truncateFileName} from '../utils/truncate-file-name';

export const useGetFile = (accountId: Account['id'], bankStatementId: BankStatement['id']) => {
  const [downloadReady, setDownloadReady] = useState(false);
  const {
    refetch: fetchFile,
    data: file,
    isLoading,
    isError,
  } = useQuery<File, Error>({
    queryKey: ['file', accountId, bankStatementId],
    queryFn: async () => {
      const response = await api.get(
        `/accounts/${accountId}/bank-statements/${bankStatementId}/file`,
      );
      const arrayBuffer = await response.arrayBuffer();

      let name = response.headers.get('Content-Disposition')?.split('filename=')[1];
      if (name) {
        name = name.replace(/"/g, '').trim();
      } else {
        name = 'file';
      }

      let type = response.headers.get('Content-Type') || 'application/octet-stream';
      type = type.split(';')[0].trim();

      if (!name.includes('.')) {
        const mimeTypeKey = getMimeTypeKey(type as MimeType);
        const extension = mimeTypeKey ? mimeTypeKey.toLowerCase() : 'bin';
        name = `${name}.${extension}`;
      }

      return new File([arrayBuffer], name, {type});
    },
    enabled: false,
    gcTime: 60000,
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'File could not be downloaded. Please try again.',
    });
  }

  useEffect(() => {
    if (downloadReady && file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('File download successful.', {
        description: `${truncateFileName(file.name)} has been downloaded.`,
      });
      setDownloadReady(false);
    }
  }, [file, downloadReady, setDownloadReady]);

  return {fetchFile, file, isLoading, setDownloadReady};
};
