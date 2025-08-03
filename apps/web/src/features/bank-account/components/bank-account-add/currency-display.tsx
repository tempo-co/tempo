import Flag from 'react-world-flags';

import {cn} from '@/utils/cn';

import {Currency} from '../../types/currency';

type CurrencyDisplayProps = {
  currency: Currency;
  className?: string;
  showName?: boolean;
};

export function CurrencyDisplay({currency, className, showName = true}: CurrencyDisplayProps) {
  return (
    <div className='flex items-center text-left'>
      <div className={cn('mr-3', className)}>
        <Flag code={currency.regionCode} className='w-7 rounded-md' />
      </div>
      <div className='flex flex-col'>
        <span>{currency.code}</span>
        {showName && <span className='text-xs text-muted-foreground'>{currency.name}</span>}
      </div>
    </div>
  );
}
