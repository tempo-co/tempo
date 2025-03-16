import {Calendar} from '@/components/ui/calendar';
import {BankStatement} from '@/types/bank-statement';

import {getModifiers, mergePeriods} from '../utils/create-calendar-periods';

type BankStatementCalendarViewProps = {
  bankStatements: BankStatement[];
};

export function BankStatementCalendarView({bankStatements}: BankStatementCalendarViewProps) {
  const mergedPeriods = mergePeriods(bankStatements);
  const modifiers = getModifiers(mergedPeriods);

  const modifiersClassNames = {
    bankStatement: 'bg-secondary rounded-none hover:bg-primary',
    bankStatementStart: 'rounded-l-md',
    bankStatementEnd: 'rounded-r-md',
    bankStatementMonday: 'rounded-l-md',
    bankStatementSunday: 'rounded-r-md',
  };

  return (
    <Calendar
      ISOWeek
      mode='range'
      defaultMonth={mergedPeriods[0]?.start ?? new Date()}
      numberOfMonths={1}
      disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
      className='my-10 w-fit rounded-md border shadow-sm'
      modifiers={modifiers}
      modifiersClassNames={modifiersClassNames}
    />
  );
}
