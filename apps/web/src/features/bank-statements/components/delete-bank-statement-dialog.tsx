import {useParams} from '@tanstack/react-router';
import {Loader, Trash2} from 'lucide-react';
import prettyBytes from 'pretty-bytes';
import {useState} from 'react';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {BankStatement} from '@/types/bank-statement';
import {getMimeTypeKey} from '@/types/file';

import {useDeleteBankStatement} from '../api/use-delete-bank-statement';
import {formatPeriod} from '../utils/format-period';

type DeleteBankStatementDialogProps = {
  bankStatement: BankStatement;
};

export function DeleteBankStatementDialog({bankStatement}: DeleteBankStatementDialogProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const {mutateAsync, isPending} = useDeleteBankStatement(accountId, bankStatement.id);

  const handleDelete = async () => {
    await mutateAsync();
    setOpen(false);
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button size='icon' variant='ghost' className='hover:bg-destructive'>
                  <Trash2 className='w-4' />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete Bank Statement</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DialogContent aria-describedby='Delete Bank Statement' className='max-w-[38rem]'>
          <DialogHeader>
            <DialogTitle>Delete Bank Statement</DialogTitle>
            <DialogDescription className='pt-2'>
              Are you sure you want to delete this bank statement
              {bankStatement.transactions.length > 0 && (
                <>
                  <span>, including all of its</span>{' '}
                  <span className='text-foreground'>
                    {bankStatement.transactions.length}{' '}
                    {bankStatement.transactions.length === 1 ? 'transaction' : 'transactions'}
                  </span>
                </>
              )}
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Card className='flex items-center p-4'>
            <div className='mr-4 rounded-md bg-muted p-3'>
              <MimeTypeIcon mimeType={bankStatement.file.mimeType} />
            </div>
            <div>
              <p className='mb-1 max-w-[28.5rem] truncate text-base text-foreground'>
                {bankStatement.file.name}
              </p>
              <span className='mt-1 whitespace-nowrap text-sm text-muted-foreground'>
                <span>{getMimeTypeKey(bankStatement.file.mimeType)}</span>
                <span className='mx-3'>•</span>
                <span>{prettyBytes(Number(bankStatement.file.size))}</span>
                <span className='mx-3'>•</span>
                <span>{bankStatement.transactions.length} transactions</span>
                {bankStatement.transactions.length > 0 && (
                  <>
                    <span className='mx-3'>•</span>
                    <span>{formatPeriod(bankStatement.period)}</span>
                  </>
                )}
              </span>
            </div>
          </Card>
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='outline'>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant='destructive'
              className='text-foreground'
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <span>Deleting...</span>
                  <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                </>
              ) : (
                <span>Delete</span>
              )}
            </Button>
          </DialogFooter>
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
              <Button size='icon' variant='ghost' className='hover:bg-destructive'>
                <Trash2 className='w-4' />
              </Button>
            </DrawerTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Delete Bank Statement</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DrawerContent aria-describedby='Delete Bank Statement'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Delete Bank Statement</DrawerTitle>
          <DrawerDescription className='pt-2'>
            Are you sure you want to delete this bank statement, including all of its{' '}
            <span className='text-foreground'>
              {bankStatement.transactions.length} transactions
            </span>{' '}
            from <span className='text-foreground'>{formatPeriod(bankStatement.period)}</span>? This
            action cannot be undone.
          </DrawerDescription>
        </DrawerHeader>
        <Card className='mx-4 flex items-center p-4'>
          <div className='mr-4 rounded-md bg-muted p-3'>
            <MimeTypeIcon mimeType={bankStatement.file.mimeType} />
          </div>
          <div className='overflow-hidden'>
            <p className='mb-1 max-w-[35rem] truncate text-base text-foreground'>
              {bankStatement.file.name}
            </p>
            <span className='mt-1 text-sm text-muted-foreground'>
              <span>{getMimeTypeKey(bankStatement.file.mimeType)}</span>
              <span className='mx-3'>•</span>
              <span>{prettyBytes(Number(bankStatement.file.size))}</span>
              <span className='mx-3 hidden sm:inline-block'>•</span>
              <span className='hidden sm:inline-block'>
                {bankStatement.transactions.length} transactions
              </span>
              <span className='mx-3 hidden sm:inline-block'>•</span>
              <span className='hidden sm:inline-block'>{formatPeriod(bankStatement.period)}</span>
            </span>
          </div>
        </Card>
        <DrawerFooter className='pt-4'>
          <Button
            variant='destructive'
            className='text-foreground'
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <span>Deleting...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Delete</span>
            )}
          </Button>
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
