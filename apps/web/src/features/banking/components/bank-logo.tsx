import {Building2} from 'lucide-react';
import {useState} from 'react';

import {cn} from '@/utils/cn';

import type {BankConnectionAspsp} from '../types/bank-connection';

type BankLogoProps = {
  bank: Pick<BankConnectionAspsp, 'name' | 'logoUrl'>;
  className?: string;
  testId?: string;
};

export function BankLogo({bank, className, testId = 'bank-logo'}: BankLogoProps) {
  const [hasError, setHasError] = useState(false);

  return (
    <span
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-sm font-semibold text-slate-900 shadow-sm',
        className,
      )}
      aria-hidden='true'
      data-testid={testId}
    >
      {bank.logoUrl && !hasError ? (
        <img
          src={bank.logoUrl}
          alt=''
          className='h-full w-full object-contain p-1'
          loading='lazy'
          referrerPolicy='no-referrer'
          onError={() => setHasError(true)}
        />
      ) : bank.name ? (
        <span>{bankInitials(bank.name)}</span>
      ) : (
        <Building2 className='h-4 w-4' />
      )}
    </span>
  );
}

function bankInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (initials || name.slice(0, 2)).toUpperCase();
}
