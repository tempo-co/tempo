import {Link} from '@tanstack/react-router';
import {ChevronRight, FileQuestion, X} from 'lucide-react';
import type {ReactNode} from 'react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {LoadingLabel, TextBone, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {wholeCents} from '@/features/dashboard/utils/format';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {useGetMerchant} from '@/features/merchants/api/use-get-merchant';
import {useGetMerchants} from '@/features/merchants/api/use-get-merchants';
import {MerchantDetail} from '@/features/merchants/components/merchant-detail';
import {MerchantRow} from '@/features/merchants/components/merchant-row';
import {MerchantsOverview} from '@/features/merchants/components/merchants-overview';
import {countLabel} from '@/features/merchants/utils/merchant-format';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {HttpError} from '@/utils/api';

/** Merchants the rail lists before "All". */
const TOP = 5;

const CARD = 'grid min-w-0 content-start gap-3 p-4';

function RailHeader({title, action}: {title: string; action?: ReactNode}) {
  return (
    <header className='-my-2.5 flex min-h-11 items-center justify-between gap-2 sm:min-h-8'>
      <h2 className='text-card-title'>{title}</h2>
      {action}
    </header>
  );
}

/**
 * The period's biggest merchants by what was spent with them; each opens its details. Without a `range` yet (the
 * history that sets the period is still loading) it holds its place.
 */
export function TopMerchants({
  range,
  onSelect,
  onAll,
}: {
  range: {from: string; to: string} | null;
  onSelect: (merchantId: string) => void;
  onAll: () => void;
}) {
  const {data, isPending, isPlaceholderData, error, refetch} = useGetMerchants('', range, TOP);
  const accepted = useFiguresCurrencyAccepted();
  const page = data?.pages[0];
  // Another period's merchants, or ones in another currency, never stand under this period.
  const waiting =
    !range ||
    isPlaceholderData ||
    (!!page && page.merchants.length > 0 && !accepted(page.baseCurrency));
  // Most spent first; a group that only paid the owner, such as an employer, spent nothing.
  const merchants = page?.merchants.filter((merchant) => toCents(merchant.spent) > 0) ?? [];
  return (
    <Card role='region' aria-label='Top merchants' className={CARD}>
      <RailHeader
        title='Top merchants'
        action={
          <TextAction onClick={onAll} aria-label='All merchants' className='-mr-2 gap-0.5'>
            All <ChevronRight aria-hidden='true' />
          </TextAction>
        }
      />
      {isPending || waiting ? (
        <div aria-busy='true'>
          <LoadingLabel>Loading merchants</LoadingLabel>
          <ul aria-hidden='true' className='-mx-4 -mb-2 divide-y divide-border/60'>
            <TileRowsSkeleton count={TOP} />
          </ul>
        </div>
      ) : !page ? (
        <LoadErrorState
          size='section'
          title="Couldn't load merchants"
          error={error}
          onRetry={refetch}
        />
      ) : merchants.length === 0 ? (
        <p className='text-body-small text-muted-foreground'>No spending in this period.</p>
      ) : (
        <ul className='-mx-4 -mb-2 divide-y divide-border/60'>
          {merchants.map((merchant) => (
            <li key={merchant.id}>
              <MerchantRow
                merchant={merchant}
                onSelect={onSelect}
                detail={countLabel(merchant.count, 'transaction')}
                amount={formatMoney(merchant.spent, page.baseCurrency)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What recurring bills come to a month, with the way to Recurring. */
export function BillsCard({today}: {today: string}) {
  const {summary: loaded, error, refetch} = useGetRecurringSummary(today);
  const accepted = useFiguresCurrencyAccepted();
  const summary = loaded && accepted(loaded.baseCurrency) ? loaded : undefined;
  return (
    <Card role='region' aria-label='Bills' aria-busy={!summary || undefined} className={CARD}>
      <RailHeader
        title='Bills'
        action={
          <TextAction asChild className='-mr-2 gap-0.5'>
            <Link to='/recurring'>
              Recurring <ChevronRight aria-hidden='true' />
            </Link>
          </TextAction>
        }
      />
      {!summary && error ? (
        <LoadErrorState
          size='section'
          title="Couldn't load bills"
          error={error}
          onRetry={refetch}
        />
      ) : (
        <p className='flex flex-wrap items-baseline gap-x-2'>
          <span className='numeric text-xl font-semibold tracking-tight'>
            {summary ? (
              formatMoney(summary.expenseMonthlyTotal, summary.baseCurrency)
            ) : (
              <TextBone className='w-[5em]' />
            )}
          </span>
          <span className='text-body-small text-muted-foreground'>a month</span>
        </p>
      )}
    </Card>
  );
}

/** The balance across accounts where the period ends, with the way to Accounts. */
export function BalanceCard({
  balance,
  end,
  running,
  currency,
}: {
  balance: number | null | undefined;
  /** The day the balance is for. */
  end: string | undefined;
  running: boolean;
  currency: string | null;
}) {
  return (
    <Card
      role='region'
      aria-label='Balance'
      aria-busy={balance === undefined || undefined}
      className={CARD}
    >
      <RailHeader
        title='Balance'
        action={
          <TextAction asChild className='-mr-2 gap-0.5'>
            <Link to='/accounts'>
              Accounts <ChevronRight aria-hidden='true' />
            </Link>
          </TextAction>
        }
      />
      <p className='flex flex-wrap items-baseline gap-x-2'>
        <span className='numeric text-xl font-semibold tracking-tight'>
          {balance === undefined ? <TextBone className='w-[5em]' /> : wholeCents(balance, currency)}
        </span>
        {end && (
          <span className='text-body-small text-muted-foreground'>
            {running ? 'across accounts' : `on ${formatBankTransactionCompactDate(end)}`}
          </span>
        )}
      </p>
    </Card>
  );
}

/** One merchant's details, loading, missing or failed, in the rail or its sheet. */
export function MerchantPanel({
  id,
  onBack,
  onClose,
}: {
  id: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const {merchant, isPending, isError, error, refetch} = useGetMerchant(id);
  const accepted = useFiguresCurrencyAccepted();
  if (isPending || (merchant && !accepted(merchant.baseCurrency)))
    return <Skeleton className='h-96' role='img' aria-label='Loading merchant' />;
  if (error instanceof HttpError && error.status === 404)
    return (
      <StateMessage
        size='section'
        icon={FileQuestion}
        title='Merchant not found'
        description='There are no transactions with this merchant, or its name changed.'
      >
        <Button variant='outline' size='sm' onClick={onClose}>
          Close
        </Button>
      </StateMessage>
    );
  if (isError || !merchant)
    return (
      <LoadErrorState
        size='section'
        title="Couldn't load this merchant"
        error={error}
        onRetry={refetch}
      />
    );
  return <MerchantDetail key={merchant.id} merchant={merchant} onBack={onBack} onClose={onClose} />;
}

/** Every merchant of the period, searchable, in the rail or its sheet. */
export function AllMerchantsPanel({
  range,
  periodLabel,
  onSelect,
  onClose,
  searchInput,
  onSearchInputChange,
}: {
  range: {from: string; to: string};
  periodLabel: string;
  onSelect: (merchantId: string) => void;
  onClose: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
}) {
  return (
    <div className='grid min-w-0 gap-4'>
      <header className='grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3'>
        <div className='min-w-0'>
          <h2 className='text-section-title'>Merchants</h2>
          <p className='text-body-small text-muted-foreground'>{periodLabel}</p>
        </div>
        <Button
          variant='ghost'
          size='icon'
          onClick={onClose}
          aria-label='Close merchants'
          className='-mt-1 -mr-2 max-sm:size-11'
        >
          <X aria-hidden />
        </Button>
      </header>
      <MerchantsOverview
        range={range}
        onSelect={onSelect}
        searchInput={searchInput}
        onSearchInputChange={onSearchInputChange}
      />
    </div>
  );
}
