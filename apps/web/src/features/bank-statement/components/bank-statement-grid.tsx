import {FileText} from 'lucide-react';
import {useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Skeleton} from '@/components/ui/skeleton';
import {BankStatement} from '@/types/bank-statement';

import {BankStatementCard} from './bank-statement-delete/bank-statement-card';
import {BankStatementUploadDialog} from './bank-statement-upload/bank-statement-upload-dialog';

type BankStatementGridProps = {
  bankStatements: BankStatement[];
  isPending: boolean;
  isPlaceholderData: boolean;
};

export function BankStatementGrid({
  bankStatements,
  isPending,
  isPlaceholderData,
}: BankStatementGridProps) {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  if (isPlaceholderData || isPending) {
    return <Skeleton className='h-[22rem] w-full rounded-lg bg-card' />;
  }

  const isEmptyState = bankStatements.length === 0 && !isPending;

  if (isEmptyState) {
    return (
      <EmptyState
        icon={FileText}
        title='No bank statements found'
        description='Upload bank statements to begin tracking your transactions.'
      >
        <BankStatementUploadDialog isOpen={isUploadDialogOpen} setIsOpen={setIsUploadDialogOpen} />
      </EmptyState>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='mb-4 flex items-end justify-between'>
        <h1 className='text-2xl font-semibold'>Bank Statements</h1>
        <BankStatementUploadDialog isOpen={isUploadDialogOpen} setIsOpen={setIsUploadDialogOpen} />
      </div>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3'>
        {bankStatements.map((bankStatement) => (
          <BankStatementCard key={bankStatement.id} bankStatement={bankStatement} />
        ))}
      </div>
    </div>
  );
}
