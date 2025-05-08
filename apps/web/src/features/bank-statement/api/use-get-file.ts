import {useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {File as FileEntity} from '@/types/file';
import {HttpError, api} from '@/utils/api';

import {downloadFile} from '../utils/download-file';
import {extractFileMetadata} from '../utils/extract-file-metadata';
import {truncateFileName} from '../utils/truncate-file-name';

export const useGetFile = (id: FileEntity['id']) => {
  const [downloadReady, setDownloadReady] = useState(false);
  const {
    refetch: fetchFile,
    data: file,
    isLoading,
    isError,
  } = useQuery<File, HttpError>({
    queryKey: ['file', id],
    queryFn: async () => {
      const {url} = await api.get(`/files/${id}`);

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const {fileName, mimeType} = extractFileMetadata(response.headers);

      return new File([arrayBuffer], fileName, {type: mimeType});
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
      downloadFile(file);

      toast.success('File download successful.', {
        description: `${truncateFileName(file.name)} has been downloaded.`,
      });
      setDownloadReady(false);
    }
  }, [file, downloadReady, setDownloadReady]);

  return {fetchFile, file, isLoading, setDownloadReady};
};
