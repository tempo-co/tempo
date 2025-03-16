import {ComponentType, SVGProps, Suspense, lazy} from 'react';

import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

type DynamicBankIconProps = {
  bank: Bank;
  className?: string;
};

export function DynamicBankIcon({bank, className}: DynamicBankIconProps) {
  const fileName = bank.replace(' ', '-').toLowerCase();
  const BankIcon = lazy(
    () =>
      import(`@/components/shared/bank-icons/${fileName}.tsx`) as Promise<{
        default: ComponentType<SVGProps<SVGSVGElement>>;
      }>,
  );

  return (
    <Suspense fallback={<div className={cn('fill-foreground', className)}></div>}>
      <BankIcon className={cn('fill-foreground', className)} />
    </Suspense>
  );
}
