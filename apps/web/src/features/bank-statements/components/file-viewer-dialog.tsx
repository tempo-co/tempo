import {useMemo} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {Progress} from '@/components/ui/progress';
import {useMediaQuery} from '@/hooks/use-media-query';
import {BankStatement} from '@/types/bank-statement';
import {cn} from '@/utils/cn';

import {truncateFileName} from '../utils/truncate-file-name';
import {FileMetadata} from './file-metadata';
import {FileViewer} from './file-viewer';

type FileViewerDialogProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  file?: File;
  bankStatement?: BankStatement;
  progressValue?: number;
  isPending?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
};

export function FileViewerDialog({
  open,
  setOpen,
  file,
  bankStatement,
  progressValue,
  isPending,
  isError,
  isSuccess,
}: FileViewerDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {truncatedFileName, fileSize, fileType} = useMemo(() => {
    const fileName = file?.name || bankStatement?.file.name;
    const size = file?.size || bankStatement?.file.size;
    const type = file?.type || bankStatement?.file.type;
    const truncatedName = fileName ? truncateFileName(fileName) : '';

    return {truncatedFileName: truncatedName, fileSize: size, fileType: type};
  }, [file, bankStatement]);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby='View file'
          className={cn('h-[80%] max-w-[70%] gap-0', isError && 'border-destructive')}
        >
          <DialogHeader>
            <DialogTitle>{truncatedFileName}</DialogTitle>
            <DialogDescription>
              {fileSize && fileType && (
                <FileMetadata
                  fileSize={fileSize}
                  fileType={fileType}
                  fileUploadedAt={bankStatement?.uploadedAt}
                  isPending={isPending}
                  isError={isError}
                  isSuccess={isSuccess}
                />
              )}
            </DialogDescription>
          </DialogHeader>
          {isPending && progressValue && <Progress value={progressValue} className='!my-4 h-1' />}
          <FileViewer file={file} bankStatementId={bankStatement?.id} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent aria-describedby='File' className='h-[100%] px-4'>
        <DrawerHeader className='px-0 text-left'>
          <DrawerTitle>{truncatedFileName}</DrawerTitle>
          <DrawerDescription>
            {fileSize && fileType && (
              <FileMetadata
                fileSize={fileSize}
                fileType={fileType}
                fileUploadedAt={bankStatement?.uploadedAt}
                isPending={isPending}
                isError={isError}
                isSuccess={isSuccess}
              />
            )}
            {isPending && progressValue && <Progress value={progressValue} className='mt-2 h-1' />}
          </DrawerDescription>
        </DrawerHeader>
        <FileViewer file={file} bankStatementId={bankStatement?.id} />
        <DrawerFooter className='px-0 pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
