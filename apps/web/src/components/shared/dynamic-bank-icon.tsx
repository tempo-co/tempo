import {ComponentType, SVGProps, Suspense, lazy} from 'react';

import {Bank} from '@/types/bank';

type DynamicBankIconProps = {
  bank: Bank;
  className?: string;
};

export function DynamicBankIcon({bank, ...props}: DynamicBankIconProps) {
  const fileName = bank.replace(' ', '-').toLowerCase();
  const IconComponent = lazy(
    () =>
      import(`@/assets/bank-icons/${fileName}.tsx`) as Promise<{
        default: ComponentType<SVGProps<SVGSVGElement>>;
      }>,
  );

  return (
    <Suspense fallback={<div {...props}></div>}>
      <IconComponent {...props} />
    </Suspense>
  );
}
