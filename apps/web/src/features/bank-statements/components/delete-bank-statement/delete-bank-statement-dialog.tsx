import {useParams} from '@tanstack/react-router';
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
import {DeleteBankStatementDialogDescription} from './delete-bank-statement-dialog-description';

type DeleteBankStatementDialogProps = {
  bankStatement: BankStatement;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function DeleteBankStatementDialog({
  bankStatement,
  open,
  setOpen,
}: DeleteBankStatementDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {accountId} = useParams({
    from: '/(accounts)/(statements)/accounts_/$accountId/bank-statements',
  });

  const {mutateAsync, isPending} = useDeleteBankStatement(accountId, bankStatement.id);

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
              <DeleteBankStatementDialogDescription
                transactionsCount={bankStatement.transactions.length}
                period={bankStatement.period}
              />
            </DialogDescription>
          </DialogHeader>
          <BankStatementCard bankStatement={bankStatement} />
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
      <DrawerContent aria-describedby='Delete Bank Statement'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Delete Bank Statement</DrawerTitle>
          <DrawerDescription className='pt-2'>
            <DeleteBankStatementDialogDescription
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
