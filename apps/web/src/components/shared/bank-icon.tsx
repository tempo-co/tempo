import {ComponentType, SVGProps} from 'react';

import AbnAmroIcon from '@/components/shared/bank-icons/abn-amro';
import RevolutIcon from '@/components/shared/bank-icons/revolut';
import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

type BankIconProps = {
  bank: Bank;
  className?: string;
};

const bankIconMap: {[key in Bank]: ComponentType<SVGProps<SVGSVGElement>>} = {
  [Bank.ABN_AMRO]: AbnAmroIcon,
  [Bank.REVOLUT]: RevolutIcon,
};

export function BankIcon({bank, className}: BankIconProps) {
  const BankIconComponent = bankIconMap[bank];

  return <BankIconComponent className={cn('fill-foreground', className)} />;
}
