import {Link, useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis} from 'recharts';

import {ChartContainer, ChartTooltip} from '@/components/ui/chart';

import type {BankTransactionSummary} from '../types/bank-transaction-summary';
import {parseCalendarDate, periodDrill} from '../utils/drill-links';
import {formatMoney, formatWholeNumber} from '../utils/money';
import {formatMonth, formatMonthRange} from '../utils/month';

type Props = {summary: BankTransactionSummary; isCurrentMonth: boolean};

export function SpendingPaceChart({summary, isCurrentMonth}: Props) {
  const navigate = useNavigate();
  const {month, daily, baseline, baseCurrency, daysInMonth} = summary;
  const hasBaseline = baseline.months.length > 0;
  const hasRange = baseline.months.length >= 2;
  const dateFor = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
  const labelFor = (day: number) => format(parseCalendarDate(dateFor(day)), 'd MMM');
  const data = Array.from({length: daysInMonth}, (_, index) => {
    const day = index + 1;
    const actual = daily[index];
    const usual = baseline.daily[index];
    return {
      day,
      cumulative: actual ? Number(actual.cumulative) : null,
      average: usual ? Number(usual.average) : null,
      range:
        usual?.low != null && usual.high != null ? [Number(usual.low), Number(usual.high)] : null,
    };
  });

  return (
    <div className='mt-4'>
      <ChartContainer
        className='aspect-auto h-60 w-full [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-ring [&_.recharts-surface:focus-visible]:outline-solid'
        config={{
          cumulative: {color: 'hsl(var(--primary))'},
          average: {color: 'hsl(var(--muted-foreground))'},
        }}
        aria-label={`Cumulative spending in ${formatMonth(month)}: ${formatMoney(summary.totals.spending, baseCurrency)}.`}
      >
        <ComposedChart
          data={data}
          margin={{left: 0, right: 8, top: 8, bottom: 0}}
          onClick={(state) => {
            const day = Number(state.activeLabel);
            if (day >= 1 && day <= daily.length) {
              const date = dateFor(day);
              void navigate({to: '/bank-transactions', search: periodDrill(date, date)});
            }
          }}
        >
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          <XAxis
            dataKey='day'
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickFormatter={labelFor}
          />
          <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={formatWholeNumber} />
          <ChartTooltip
            content={({active, label}) => {
              const day = Number(label);
              if (!active || !day) return null;
              const actual = daily[day - 1];
              const usual = baseline.daily[day - 1];
              return (
                <div className='border bg-card p-2.5 text-xs shadow-sm'>
                  <p className='font-semibold'>{labelFor(day)}</p>
                  {actual && (
                    <>
                      <p>Spent that day: {formatMoney(actual.spending, baseCurrency)}</p>
                      <p>Month so far: {formatMoney(actual.cumulative, baseCurrency)}</p>
                    </>
                  )}
                  {usual && <p>Usual by then: {formatMoney(usual.average, baseCurrency)}</p>}
                  {usual?.low != null && usual.high != null && (
                    <p>
                      Range: {formatMoney(usual.low, baseCurrency)}–
                      {formatMoney(usual.high, baseCurrency)}
                    </p>
                  )}
                </div>
              );
            }}
          />
          {hasRange && (
            <Area
              dataKey='range'
              stroke='none'
              fill='var(--color-average)'
              fillOpacity={0.2}
              isAnimationActive={false}
            />
          )}
          {hasBaseline && (
            <Line
              dataKey='average'
              stroke='var(--color-average)'
              strokeDasharray='4 4'
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            dataKey='cumulative'
            stroke='var(--color-cumulative)'
            strokeWidth={2.5}
            dot={daily.length === 1 ? {r: 4, fill: 'var(--color-cumulative)'} : false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {isCurrentMonth && (
            <ReferenceLine
              x={daily.length}
              stroke='hsl(var(--foreground) / 0.3)'
              strokeDasharray='2 3'
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <div className='mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1.5'>
          <i className='w-4 border-t-2 border-primary' />
          {formatMonth(month)}
        </span>
        {hasBaseline && (
          <span className='flex items-center gap-1.5'>
            <i className='w-4 border-t-2 border-dashed border-muted-foreground' />
            Usual (avg of {formatMonthRange(baseline.months)})
          </span>
        )}
        {hasRange && (
          <span className='flex items-center gap-1.5'>
            <i className='h-3 w-4 bg-muted-foreground/20' />
            Lowest to highest
          </span>
        )}
        <span className='basis-full'>Hover a day for exact values · click to open it</span>
      </div>
      <div className='sr-only focus-within:not-sr-only focus-within:mt-4 focus-within:max-w-full focus-within:overflow-x-auto'>
        <table
          aria-label='Exact daily spending'
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:font-mono [&_td]:tabular-nums [&_th]:px-2 [&_th]:py-2'
        >
          <thead>
            <tr>
              <th>Day</th>
              <th>Spent</th>
              <th>Cumulative</th>
              <th>Usual</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.day}>
                <td>
                  <Link
                    to='/bank-transactions'
                    search={periodDrill(dateFor(day.day), dateFor(day.day))}
                    className='underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  >
                    {labelFor(day.day)}
                  </Link>
                </td>
                <td>{formatMoney(day.spending, baseCurrency)}</td>
                <td>{formatMoney(day.cumulative, baseCurrency)}</td>
                <td>
                  {baseline.daily[day.day - 1]
                    ? formatMoney(baseline.daily[day.day - 1].average, baseCurrency)
                    : 'No baseline'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
