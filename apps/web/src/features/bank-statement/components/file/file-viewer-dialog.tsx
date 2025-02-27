import {useMemo} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {useMediaQuery} from '@/hooks/use-media-query';
import {BankStatement} from '@/types/bank-statement';
import {cn} from '@/utils/cn';

import {truncateFileName} from '../../utils/truncate-file-name';
import {FileMetadata} from './file-metadata';
import {FileViewer} from './file-viewer';

type FileViewerDialogProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  file?: File;
  bankStatement?: BankStatement;
  isPending?: boolean;
  error?: string | null;
  isSuccess?: boolean;
};

export function FileViewerDialog({
  open,
  setOpen,
  file,
  bankStatement,
  isPending,
  error,
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
          className={cn('h-[80%] max-w-[70%] gap-0', error && 'border-destructive')}
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
                  error={error}
                  isSuccess={isSuccess}
                />
              )}
            </DialogDescription>
          </DialogHeader>
          <FileViewer file={file} bankStatementId={bankStatement?.id} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='outline' className='mt-4 w-full'>
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
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
                error={error}
                isSuccess={isSuccess}
              />
            )}
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
