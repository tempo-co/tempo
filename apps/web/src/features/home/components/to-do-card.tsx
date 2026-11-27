import {Link} from '@tanstack/react-router';
import {CircleCheck, CircleDashed, ListChecks, type LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';

import {Button} from '@/components/ui/button';
import {LoadingLabel, TileRowsSkeleton} from '@/features/dashboard/components/loading';

import type {ToDoRow} from '../utils/to-do-rows';
import {type CardEditing, HomeCard} from './home-card';

type RowView = {icon: LucideIcon; title: string; detail: string; action?: ReactNode};

const VIEWS: {[K in ToDoRow['kind']]: (row: Extract<ToDoRow, {kind: K}>) => RowView} = {
  check: ({count}) => ({
    icon: ListChecks,
    title: `Check ${count.toLocaleString()} ${count === 1 ? 'transaction' : 'transactions'}`,
    detail: 'Pick their categories',
    action: (
      <Button asChild size='sm'>
        <Link to='/transactions' search={{needsAttention: true}}>
          Check
        </Link>
      </Button>
    ),
  }),
  setup: ({done, total, next}) => ({
    icon: CircleDashed,
    title: 'Finish setting up',
    detail: `${done} of ${total} done · next: ${next}`,
  }),
};

/** One card for everything that needs the owner, each row typed by what it asks; hidden when nothing does. */
export function ToDoCard({rows, editing}: {rows: ToDoRow[] | undefined; editing?: CardEditing}) {
  // With nothing to act on the card stays out of the way, except while customizing.
  if (rows?.length === 0 && !editing) return null;
  return (
    <HomeCard name='To do' editing={editing}>
      {!rows ? (
        <div aria-busy='true'>
          {/* Shown with data, the card holds what to check and the setup still left: two rows. */}
          <ul className='-mx-3 grid'>
            <TileRowsSkeleton count={2} />
          </ul>
          <LoadingLabel>Loading what needs you</LoadingLabel>
        </div>
      ) : rows.length === 0 ? (
        <p className='flex items-center gap-2 text-body-small text-muted-foreground'>
          <CircleCheck aria-hidden='true' className='size-4 text-success' />
          Nothing needs you right now.
        </p>
      ) : (
        <ul className='-mx-3 grid'>
          {rows.map((row) => (
            <ToDoItem key={row.kind} view={(VIEWS[row.kind] as (row: ToDoRow) => RowView)(row)} />
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

function ToDoItem({view: {icon: Icon, title, detail, action}}: {view: RowView}) {
  return (
    <li className='grid min-h-15 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2'>
      <span
        aria-hidden='true'
        className='grid size-9 place-items-center rounded-full border border-transaction-tile-border bg-transaction-tile text-transaction-tile-foreground'
      >
        <Icon className='size-4' />
      </span>
      <span className='min-w-0'>
        <span className='block text-body font-medium'>{title}</span>
        <span className='block text-body-small text-muted-foreground'>{detail}</span>
      </span>
      {action}
    </li>
  );
}
