import {useQueryClient} from '@tanstack/react-query';
import {AlertCircle, CheckCircle2, Loader, X} from 'lucide-react';
import {useEffect} from 'react';

import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {useUploads} from '@/hooks/use-uploads';
import {UploadingFile} from '@/providers/uploads.provider';
import {cn} from '@/utils/cn';

import {useGetUploadStatus} from '../../api/use-get-upload-status';

type UploadingFileCardProps = {
  uploadingFile: UploadingFile;
  onDismiss: (jobId: string) => void;
  isAnimating: boolean;
};

export function UploadingFileCard({uploadingFile, onDismiss, isAnimating}: UploadingFileCardProps) {
  const {updateUploadingFileStatus} = useUploads();
  const {job, error} = useGetUploadStatus(uploadingFile.bankAccountId, uploadingFile.jobId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (uploadingFile.status !== 'processing') return;

    const isJobDone = job?.status === 'completed' || job?.status === 'failed';
    const isJobNotFound = error && error.status === 404;

    if (isJobDone || isJobNotFound) {
      void queryClient.invalidateQueries({queryKey: ['bank-statements']});
      const hasFailed = job?.status === 'failed' || (error && !isJobNotFound);
      updateUploadingFileStatus(uploadingFile.jobId, hasFailed ? 'failed' : 'completed');
    }
  }, [
    job,
    error,
    uploadingFile.jobId,
    uploadingFile.status,
    queryClient,
    updateUploadingFileStatus,
  ]);

  const getStatusInfo = () => {
    switch (uploadingFile.status) {
      case 'completed':
        return {
          icon: <CheckCircle2 className='h-5 w-5 text-success' />,
          message: 'Completed',
          progress: 100,
        };
      case 'failed':
        return {
          icon: <AlertCircle className='h-5 w-5 text-destructive' />,
          message: job?.failedReason || 'An error occurred',
          progress: job?.progress || 0,
        };
      case 'processing':
      default:
        return {
          icon: <Loader className='h-5 w-5 animate-slow-spin text-muted-foreground' />,
          message: `Processing... ${job?.progress || 0}%`,
          progress: job?.progress || 0,
        };
    }
  };

  const {icon, message, progress} = getStatusInfo();
  const isFinished = uploadingFile.status === 'completed' || uploadingFile.status === 'failed';

  return (
    <div className='grid grid-cols-[auto_1fr_auto] items-center gap-3'>
      <div>{icon}</div>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>{uploadingFile.file.name}</p>
        <p className={cn('text-xs text-muted-foreground', isAnimating && 'truncate')}>{message}</p>
        {uploadingFile.status === 'processing' && (
          <Progress value={progress} className='mt-1 h-1.5' />
        )}
      </div>
      <div>
        {isFinished && (
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6 p-4'
            onClick={() => onDismiss(uploadingFile.jobId)}
          >
            <X className='h-4 w-4' />
          </Button>
        )}
      </div>
    </div>
  );
}
