import {AlertCircle, CheckCircle2, ChevronUp, UploadIcon} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useMediaQuery} from '@/hooks/use-media-query';
import {useOnClickOutside} from '@/hooks/use-on-click-outside';
import {useUploads} from '@/hooks/use-uploads';
import {cn} from '@/utils/cn';

import {UploadingFileCard} from './uploading-file-card';

const ANIMATION_DURATION = 300;

export function UploadsPanel() {
  const {uploadingFiles, removeUploadingFile, clearFinishedUploads} = useUploads();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), ANIMATION_DURATION);
    return () => clearTimeout(timer);
  }, [isCollapsed]);

  useOnClickOutside(panelRef, () => {
    if (!isCollapsed) {
      setIsCollapsed(true);
    }
  });

  useEffect(() => {
    if (uploadingFiles.length > 0) {
      setIsCollapsed(false);
    }
  }, [uploadingFiles.length]);

  const {processingCount, failedCount} = useMemo(() => {
    let processing = 0;
    let failed = 0;

    for (const file of uploadingFiles) {
      if (file.status === 'processing') processing++;
      if (file.status === 'failed') failed++;
    }

    return {processingCount: processing, failedCount: failed};
  }, [uploadingFiles]);

  if (uploadingFiles.length === 0) {
    return null;
  }

  const getPanelStatus = () => {
    if (processingCount > 0) return 'processing';
    if (failedCount > 0) return 'error';
    return 'success';
  };

  const panelStatus = getPanelStatus();

  const getPanelHeader = () => {
    switch (panelStatus) {
      case 'error':
        return {
          icon: <AlertCircle className='mr-2 h-5 w-5 text-destructive' />,
          title: `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`,
        };
      case 'success':
        return {
          icon: <CheckCircle2 className='mr-2 h-5 w-5 text-success' />,
          title: 'Uploads Complete',
        };
      case 'processing':
      default:
        return {
          icon: <UploadIcon className='mr-2 h-5 w-5' />,
          title: `${processingCount} Upload${processingCount > 1 ? 's' : ''} in Progress`,
        };
    }
  };

  const {icon, title} = getPanelHeader();
  const allFinished = processingCount === 0;

  return (
    <div
      ref={panelRef}
      style={{'--animation-duration': `${ANIMATION_DURATION}ms`} as React.CSSProperties}
      className={cn(
        'fixed z-50 border bg-card shadow-lg transition-all ease-in-out',
        'duration-[var(--animation-duration)]',
        isMobile ? 'inset-x-0 top-0 w-full rounded-none' : 'right-4 top-4 rounded-lg',
        !isMobile && (isCollapsed ? 'w-64' : 'w-[25rem]'),
      )}
    >
      <Button
        variant='ghost'
        className={cn(
          'flex w-full items-center justify-between p-4 text-left',
          panelStatus === 'error' &&
            'border-destructive bg-destructive-foreground/60 hover:bg-destructive-foreground/40',
          panelStatus === 'success' &&
            'border-success bg-success-foreground/60 hover:bg-success-foreground/40',
          panelStatus === 'processing' && 'bg-card',
          isMobile && 'h-16',
        )}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className='flex items-center'>
          {icon}
          <span className='font-medium text-card-foreground'>{title}</span>
        </div>
        <ChevronUp
          className={cn(
            'h-5 w-5 text-card-foreground transition-transform duration-200',
            isCollapsed && 'rotate-180',
          )}
        />
      </Button>

      {!isCollapsed && (
        <>
          <ScrollArea
            className={cn('border-t', uploadingFiles.length > 15 && 'h-[calc(100vh-8rem)]')}
          >
            <div className='space-y-5 p-4'>
              {uploadingFiles.map((file) => (
                <UploadingFileCard
                  key={file.jobId}
                  uploadingFile={file}
                  onDismiss={removeUploadingFile}
                  isAnimating={isAnimating}
                />
              ))}
            </div>
          </ScrollArea>
          {allFinished && (
            <div className='border-t p-2'>
              <Button variant='ghost' className='w-full' onClick={clearFinishedUploads}>
                Clear all
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
