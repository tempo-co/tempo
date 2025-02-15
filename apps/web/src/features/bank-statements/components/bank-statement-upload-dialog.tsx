import {PaginationState} from '@tanstack/react-table';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {useMediaQuery} from '@/hooks/use-media-query';

import {BankStatementUploadInput} from './bank-statement-upload-input';

type BankStatementUploadDialogProps = {
  pagination: PaginationState;
};

export function BankStatementUploadDialog({pagination}: BankStatementUploadDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [open, setOpen] = useState(false);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Upload bank statement</Button>
        </DialogTrigger>
        <DialogContent className='mx-10 max-w-[60rem]' aria-describedby='Upload bank statement'>
          <DialogHeader>
            <DialogTitle>Upload bank statement</DialogTitle>
          </DialogHeader>
          <BankStatementUploadInput pagination={pagination} />
        </DialogContent>
      </Dialog>
    );
  }

  return <BankStatementUploadInput pagination={pagination} />;
}
