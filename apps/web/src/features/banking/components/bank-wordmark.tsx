import type {BankConnectionAspsp} from '@tempo/contracts';

import {cn} from '@/utils/cn';

import {BankLogo} from './bank-logo';

/** Provider wordmarks keep a wide slot at fixed height instead of shrinking into a square. */
export function BankWordmark({
  bank,
  size = 'md',
  className,
}: {
  bank: Pick<BankConnectionAspsp, 'name' | 'logoUrl' | 'logo'>;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <BankLogo
      bank={bank}
      testId='bank-wordmark'
      className={cn(size === 'lg' ? 'h-14 w-48 text-lg' : 'h-9 w-28 text-xs', className)}
      imageClassName={cn(
        'w-auto max-w-full object-center',
        size === 'lg' ? 'px-3 py-2.5' : 'px-2 py-1.5',
      )}
    />
  );
}
