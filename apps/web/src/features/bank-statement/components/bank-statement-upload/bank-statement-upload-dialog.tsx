import {PaginationState} from '@tanstack/react-table';
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

import {FileState} from '../../types/file-state';
import {BankStatementUploadInput} from './bank-statement-upload-input';

type BankStatementUploadDialogProps = {
  pagination: PaginationState;
};

export function BankStatementUploadDialog({pagination}: BankStatementUploadDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileState[]>([]);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className='w-fit items-end'>Upload bank statement</Button>
        </DialogTrigger>
        <DialogContent className='mx-10 max-w-[50rem]' aria-describedby='Upload bank statement'>
          <DialogHeader>
            <DialogTitle>Upload bank statement</DialogTitle>
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
