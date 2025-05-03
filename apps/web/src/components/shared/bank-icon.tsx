import {ComponentType, SVGProps} from 'react';

import AbnAmroIcon from '@/assets/icons/bank-icons/abn-amro';
import RevolutIcon from '@/assets/icons/bank-icons/revolut';
import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

type BankIconProps = {
  bank: Bank;
  className?: string;
};

const bankIcons: {[key in Bank]: ComponentType<SVGProps<SVGSVGElement>>} = {
  [Bank.ABN_AMRO]: AbnAmroIcon,
  [Bank.REVOLUT]: RevolutIcon,
};

export function BankIcon({bank, className}: BankIconProps) {
  const BankIconComponent = bankIcons[bank];

  return <BankIconComponent className={cn('fill-foreground', className)} />;
}
