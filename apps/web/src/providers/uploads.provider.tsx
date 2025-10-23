/* eslint-disable react-refresh/only-export-components */
import {ReactNode, createContext, useCallback, useState} from 'react';

export type UploadStatus = 'processing' | 'completed' | 'failed';

export type UploadingFile = {
  id: string;
  file: File;
  jobId: string;
  bankAccountId: string;
  status: UploadStatus;
};

type UploadsContextType = {
  uploadingFiles: UploadingFile[];
  addUploadingFile: (file: Omit<UploadingFile, 'status'>) => void;
  removeUploadingFile: (jobId: string) => void;
  updateUploadingFileStatus: (jobId: string, status: UploadStatus) => void;
  clearFinishedUploads: () => void;
};

export const UploadsContext = createContext<UploadsContextType | undefined>(undefined);

export const UploadsProvider = ({children}: {children: ReactNode}) => {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const addUploadingFile = useCallback((file: Omit<UploadingFile, 'status'>) => {
    setUploadingFiles((prev) => [...prev, {...file, status: 'processing'}]);
  }, []);

  const removeUploadingFile = useCallback((jobId: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.jobId !== jobId));
  }, []);

  const updateUploadingFileStatus = useCallback((jobId: string, status: UploadStatus) => {
    setUploadingFiles((prev) => prev.map((f) => (f.jobId === jobId ? {...f, status} : f)));
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploadingFiles((prev) => prev.filter((f) => f.status === 'processing'));
  }, []);

  return (
    <UploadsContext.Provider
      value={{
        uploadingFiles,
        addUploadingFile,
        removeUploadingFile,
        updateUploadingFileStatus,
        clearFinishedUploads,
      }}
    >
      {children}
    </UploadsContext.Provider>
  );
};
