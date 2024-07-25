import dayjs from 'dayjs';

import {BankStatement} from '@/types/bank-statement';

export function formatPeriod(period: BankStatement['period']) {
  if (period && period.start && period.end) {
    const formattedStart = dayjs(period.start).format('DD/MM/YYYY');
    const formattedEnd = dayjs(period.end).format('DD/MM/YYYY');
    return `${formattedStart} - ${formattedEnd}`;
  }
  return 'No Period';
}
