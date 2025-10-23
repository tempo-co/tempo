import {Upload} from 'lucide-react';
import * as React from 'react';

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

import {BankStatementUploadInput} from './bank-statement-upload';

type BankStatementUploadDialogProps = {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankStatementUploadDialog({isOpen, setIsOpen}: BankStatementUploadDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const title = 'Upload Statement';

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button>
            <Upload className='h-4 w-4' />
            {title}
          </Button>
        </DialogTrigger>
        <DialogContent className='mx-10'>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <BankStatementUploadInput setDialogOpen={setIsOpen} />
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

  return <BankStatementUploadInput setDialogOpen={setIsOpen} />;
}
