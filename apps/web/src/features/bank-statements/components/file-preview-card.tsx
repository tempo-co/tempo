import {Check, FileSpreadsheet, Fullscreen, Loader, Trash2, X} from 'lucide-react';
import prettyBytes from 'pretty-bytes';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

type FilePreviewCardProps = {
  file: File;
  isPending: boolean;
};

export function FilePreviewCard({file, isPending}: FilePreviewCardProps) {
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Uploading file...');

  useEffect(() => {
    if (isPending) {
      const interval = setInterval(() => {
        setProgressValue((prevProgress) => {
          const increment =
            prevProgress < 50 ? 10 : prevProgress < 75 ? 5 : prevProgress < 99 ? 1 : 0;
          const newProgress = prevProgress + increment;
          if (newProgress < 30) {
            setProgressMessage('Parsing file...');
          } else if (newProgress < 50) {
            setProgressMessage('Categorizing transactions...');
          } else if (newProgress === 100) {
            setProgressMessage('Completed');
          }
          return newProgress;
        });
      }, 1500);

      return () => clearInterval(interval);
    } else {
      if (!isPending) {
        setProgressValue(100);
        setProgressMessage('Completed');
      }
    }
  }, [isPending]);

  return (
    <Card className='flex flex-col p-4'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center'>
          <div className='mr-4 rounded-md bg-muted p-2'>
            <FileSpreadsheet className='h-6 w-6' />
          </div>
          <div>
            <p>{file.name}</p>
            <p className='mt-1 flex items-center text-sm text-muted-foreground'>
              <span>{prettyBytes(file.size)}</span>
              <span className='mx-3'>•</span>
              <span>{file.type}</span>
              <span className='mx-3'>•</span>
              <div className={cn('flex items-center', !isPending && 'text-success')}>
                {isPending ? (
                  <Loader className='mr-2 inline h-4 w-4 animate-slow-spin' />
                ) : (
                  <Check className='mr-2 h-4 w-4' />
                )}
                <span>{progressMessage}</span>
              </div>
            </p>
          </div>
        </div>
        <div className='flex gap-3'>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon'>
                  <Fullscreen className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View file</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' className='hover:bg-destructive-foreground'>
                  {isPending ? <X className='h-4 w-4' /> : <Trash2 className='h-4 w-4' />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPending ? <p>Cancel upload</p> : <p>Delete statement</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {isPending && <Progress value={progressValue} className='mt-4 h-1' />}
    </Card>
  );
}
