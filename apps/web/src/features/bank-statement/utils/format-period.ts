import {format} from 'date-fns';

import {BankStatement} from '@/types/bank-statement';

export function formatPeriod(period: BankStatement['period']) {
  if (period && period.start && period.end) {
    const formattedStart = format(new Date(period.start), 'dd/MM/yyyy');
    const formattedEnd = format(new Date(period.end), 'dd/MM/yyyy');
    return `${formattedStart} - ${formattedEnd}`;
  }
  return 'No Period';
}
