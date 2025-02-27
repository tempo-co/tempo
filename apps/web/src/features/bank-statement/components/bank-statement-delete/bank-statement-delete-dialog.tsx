import {useParams, useSearch} from '@tanstack/react-router';
import {Loader} from 'lucide-react';

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

import {useDeleteBankStatement} from '../../api/use-delete-bank-statement';
import {BankStatementCard} from './bank-statement-card';
import {BankStatementDeleteDialogDescription} from './bank-statement-delete-dialog-description';

type BankStatementDeleteDialogProps = {
  bankStatement: BankStatement;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankStatementDeleteDialog({
  bankStatement,
  open,
  setOpen,
}: BankStatementDeleteDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements/'});
  const {pageIndex, pageSize} = useSearch({from: '/accounts/$accountId/bank-statements/'});

  const {mutateAsync, isPending} = useDeleteBankStatement(accountId, bankStatement.id, {
    pageIndex,
    pageSize,
  });

  const handleDelete = async () => {
    await mutateAsync();
    setOpen(false);
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby='Delete Bank Statement' className='max-w-[33rem]'>
          <DialogHeader>
            <DialogTitle>Delete Bank Statement</DialogTitle>
            <DialogDescription className='pt-2'>
              <BankStatementDeleteDialogDescription
                transactionsCount={bankStatement.transactions.length}
                period={bankStatement.period}
              />
            </DialogDescription>
          </DialogHeader>
          <BankStatementCard bankStatement={bankStatement} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='outline' className='mr-2'>
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
      <DrawerContent aria-describedby='Delete Bank Statement'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Delete Bank Statement</DrawerTitle>
          <DrawerDescription className='pt-2'>
            <BankStatementDeleteDialogDescription
              transactionsCount={bankStatement.transactions.length}
              period={bankStatement.period}
            />
          </DrawerDescription>
        </DrawerHeader>
        <div className='px-4'>
          <BankStatementCard bankStatement={bankStatement} />
        </div>
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
