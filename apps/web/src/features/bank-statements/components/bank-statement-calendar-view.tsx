import {Calendar} from '@/components/ui/calendar';
import {BankStatement} from '@/types/bank-statement';

import {getModifiers, mergePeriods, modifiersClassNames} from '../utils/create-calendar-periods';

type BankStatementCalendarViewProps = {
  bankStatements: BankStatement[];
};

export function BankStatementCalendarView({bankStatements}: BankStatementCalendarViewProps) {
  const mergedPeriods = mergePeriods(bankStatements);
  const modifiers = getModifiers(mergedPeriods);

  return (
    <Calendar
      ISOWeek
      mode='range'
      defaultMonth={mergedPeriods[0]?.start ?? new Date()}
      numberOfMonths={1}
      disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
      className='my-10 rounded-md border shadow-sm'
      modifiers={modifiers}
      modifiersClassNames={modifiersClassNames}
    />
  );
}
