import {Fullscreen} from 'lucide-react';
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
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useMediaQuery} from '@/hooks/use-media-query';

import {CsvFileViewer} from './csv-file-viewer';
import {FileMetadata} from './file-metadata';

type FileViewerDialogProps = {
  file: File;
  isPending: boolean;
  progressMessage: string;
};

export function FileViewerDialog({file, isPending, progressMessage}: FileViewerDialogProps) {
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
                  <Fullscreen className='h-4 w-4' />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>View file</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DialogContent aria-describedby='File' className='h-[80%] max-w-[70%] gap-0'>
          <DialogHeader>
            <DialogTitle>{file.name}</DialogTitle>
            <DialogDescription>
              <FileMetadata
                fileSize={file.size}
                fileType={file.type}
                isPending={isPending}
                progressMessage={progressMessage}
              />
            </DialogDescription>
          </DialogHeader>
          <CsvFileViewer file={file} />
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
                <Fullscreen className='h-4 w-4' />
              </Button>
            </DrawerTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>View file</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DrawerContent aria-describedby='File'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>{file.name}</DrawerTitle>
          <DrawerDescription>
            <FileMetadata
              fileSize={file.size}
              fileType={file.type}
              isPending={isPending}
              progressMessage={progressMessage}
            />
          </DrawerDescription>
        </DrawerHeader>
        <CsvFileViewer file={file} />
        <DrawerFooter className='pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
