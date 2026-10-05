import {Link} from '@tanstack/react-router';
import {ChevronLeft, ChevronRight} from 'lucide-react';

import {Button} from '@/components/ui/button';

import {currentMonth, formatMonth, shiftMonth} from '../utils/month';

type MonthNavigationProps = {
  month: string;
  isCurrentMonth: boolean;
};

/** The current month has no `month` param, so `/` always opens it. */
function monthSearch(month: string) {
  return month === currentMonth() ? {} : {month};
}

const arrowClassName = 'h-11 w-11 shrink-0 motion-safe:active:scale-[0.97]';

export function MonthNavigation({month, isCurrentMonth}: MonthNavigationProps) {
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-3'>
      <div className='flex items-center gap-3 sm:gap-4'>
        <Button asChild variant='outline' size='icon' className={arrowClassName}>
          <Link to='/' search={monthSearch(shiftMonth(month, -1))} aria-label='Previous month'>
            <ChevronLeft aria-hidden='true' />
          </Link>
        </Button>
        <h1 className='w-[13ch] shrink-0 text-center text-xl leading-tight font-semibold whitespace-nowrap min-[360px]:text-2xl'>
          {formatMonth(month)}
        </h1>
        {isCurrentMonth ? (
          <Button
            variant='outline'
            size='icon'
            className={arrowClassName}
            aria-label='Next month'
            disabled
          >
            <ChevronRight aria-hidden='true' />
          </Button>
        ) : (
          <Button asChild variant='outline' size='icon' className={arrowClassName}>
            <Link to='/' search={monthSearch(shiftMonth(month, 1))} aria-label='Next month'>
              <ChevronRight aria-hidden='true' />
            </Link>
          </Button>
        )}
      </div>
      {!isCurrentMonth && (
        <Link
          to='/'
          search={{}}
          className='text-sm font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
        >
          Back to this month
        </Link>
      )}
    </div>
  );
}
