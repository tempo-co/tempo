import {Bank} from '@/types/bank';
import {ComponentType, lazy, Suspense, SVGProps} from 'react';

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
