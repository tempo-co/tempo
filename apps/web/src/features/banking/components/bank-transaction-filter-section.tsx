import * as React from 'react';

import {cn} from '@/utils/cn';

type BankTransactionFilterSectionProps = {
  label: string;
  children: React.ReactNode;
  className?: string;
};

export function BankTransactionFilterSection({
  label,
  children,
  className,
}: BankTransactionFilterSectionProps) {
  return (
    <section
      className={cn('space-y-3 border-b py-4 first:pt-0 last:border-b-0 last:pb-0', className)}
    >
      <h3 className='text-sm font-medium'>{label}</h3>
      {children}
    </section>
  );
}
