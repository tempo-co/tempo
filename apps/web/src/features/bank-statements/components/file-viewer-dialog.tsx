import {FileScan} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {Progress} from '@/components/ui/progress';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {truncateFileName} from '../utils/truncate-file-name';
import {FileMetadata} from './file-metadata';
import {FileViewer} from './file-viewer';

type FileViewerDialogProps = {
  file: File;
  progressValue: number;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
};

export function FileViewerDialog({
  file,
  progressValue,
  isPending,
  isError,
  isSuccess,
}: FileViewerDialogProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant='ghost' size='icon'>
                  <FileScan className='h-4 w-4' />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>View file</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DialogContent
          aria-describedby='View file'
          className={cn('h-[80%] max-w-[70%] gap-0', isError && 'border-destructive')}
        >
          <DialogHeader>
            <DialogTitle>{truncateFileName(file.name)}</DialogTitle>
            <DialogDescription>
              <FileMetadata
                fileSize={file.size}
                fileType={file.type}
                isPending={isPending}
                isError={isError}
                isSuccess={isSuccess}
              />
            </DialogDescription>
          </DialogHeader>
          {isPending && <Progress value={progressValue} className='!my-4 h-1' />}
          <FileViewer file={file} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DrawerTrigger asChild>
              <Button variant='ghost' size='icon'>
                <FileScan className='h-4 w-4' />
              </Button>
            </DrawerTrigger>
          </TooltipTrigger>
          <TooltipContent>View file</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DrawerContent aria-describedby='File'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>{truncateFileName(file.name)}</DrawerTitle>
          <DrawerDescription>
            <FileMetadata
              fileSize={file.size}
              fileType={file.type}
              isPending={isPending}
              isError={isError}
              isSuccess={isSuccess}
            />
          </DrawerDescription>
        </DrawerHeader>
        <div className='mb-8 h-[50vh] px-4'>
          <FileViewer file={file} isDesktop={isDesktop} />
        </div>
        <DrawerFooter className='pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
