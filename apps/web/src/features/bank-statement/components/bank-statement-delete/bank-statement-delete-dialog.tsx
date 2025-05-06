import {useParams, useSearch} from '@tanstack/react-router';
import {Loader} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {BankStatement} from '@/types/bank-statement';

import {useDeleteBankStatement} from '../../api/use-delete-bank-statement';
import {BankStatementCard} from './bank-statement-card';
import {BankStatementDeleteDialogDescription} from './bank-statement-delete-dialog-description';

type BankStatementDeleteDialogProps = {
  bankStatement: BankStatement;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankStatementDeleteDialog({
  bankStatement,
  isOpen,
  setIsOpen,
}: BankStatementDeleteDialogProps) {
  const {bankAccountId} = useParams({from: '/bank-accounts/$bankAccountId/bank-statements/'});
  const {pageIndex, pageSize} = useSearch({from: '/bank-accounts/$bankAccountId/bank-statements/'});

  const {mutateAsync, isPending} = useDeleteBankStatement(bankAccountId, bankStatement.id, {
    pageIndex,
    pageSize,
  });

  const handleDelete = async () => {
    await mutateAsync();
    setIsOpen(false);
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogContent className='md:max-w-[33rem]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete Bank Statement</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            <BankStatementDeleteDialogDescription
              transactionsCount={bankStatement.transactions.length}
              period={bankStatement.period}
            />
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <BankStatementCard bankStatement={bankStatement} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className='mt-4 flex gap-4'>
          <Button
            variant='destructive'
            className='order-1 text-foreground md:order-2'
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending ? (
              <div className='flex items-center justify-center'>
                <span>Deleting bank statement...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </div>
            ) : (
              'Delete bank statement'
            )}
          </Button>
          <ResponsiveDialogClose asChild>
            <Button type='button' variant='outline' className='order-2 md:order-1'>
              Cancel
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
