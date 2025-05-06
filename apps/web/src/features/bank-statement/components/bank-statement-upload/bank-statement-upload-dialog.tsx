import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {useMediaQuery} from '@/hooks/use-media-query';
import {PaginationParams} from '@/types/pagination';

import {FileState} from '../../types/file-state';
import {BankStatementUploadInput} from './bank-statement-upload-input';

type BankStatementUploadDialogProps = {
  pagination: PaginationParams;
};

export function BankStatementUploadDialog({pagination}: BankStatementUploadDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [files, setFiles] = useState<FileState[]>([]);

  const title = 'Upload bank statement';

  if (isDesktop) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button className='w-fit items-end'>{title}</Button>
        </DialogTrigger>
        <DialogContent className='mx-10 max-w-[50rem]'>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <BankStatementUploadInput pagination={pagination} files={files} setFiles={setFiles} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='outline' className='w-full'>
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return <BankStatementUploadInput pagination={pagination} files={files} setFiles={setFiles} />;
}
