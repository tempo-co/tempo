import type {BankImportNeverSentRow, BankImportSummary} from '@tempo/contracts';
import {ChevronRight, FileX} from 'lucide-react';
import {useId, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {HttpError, wasToasted} from '@/utils/api';

import {
  useAddNeverSentRows,
  useBankImportNeverSentRows,
} from '../api/use-bank-import-never-sent-rows';
import {formatCount, plural} from '../utils/import-format';
import {
  type NeverSentGroup,
  neverSentGroups,
  neverSentLine,
  neverSentRowTitle,
} from '../utils/never-sent-rows';
import {IMPORT_TILE} from './file-choice';

/** How many groups show at first, and how many more each Show more adds; and the rows a group shows before Show all. */
const GROUPS_PAGE = 50;
const GROUP_ROWS = 5;

/**
 * The import's rows on days bank sync is final for that the bank never sent: one folded line, which opens a list
 * grouped by counterparty (else description), so a kind of payment the bank leaves out shows as one group. Each row
 * and each group can be added; nothing adds every row at once. Added rows stay listed as added.
 */
export function NeverSentRows({summary}: {summary: BankImportSummary}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Opened once in this summary, the list stays so its added rows can show as added.
  if (summary.rowsNotInBank === 0 && !open) return null;
  return (
    <section className='grid grid-cols-1 gap-3' data-testid='bank-import-never-sent'>
      <Button
        variant='ghost'
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className='h-auto min-h-11 w-full justify-start rounded-card border px-4 py-2.5 text-left text-sm font-normal whitespace-normal'
      >
        <ChevronRight
          aria-hidden='true'
          className={`shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
        {neverSentLine(summary.rowsNotInBank)}
      </Button>
      {open && (
        <div id={listId}>
          <NeverSentList summary={summary} />
        </div>
      )}
    </section>
  );
}

function NeverSentList({summary}: {summary: BankImportSummary}) {
  const {
    data: rows,
    error,
    isPending,
    isError,
    refetch,
  } = useBankImportNeverSentRows(summary.id, true);
  const {addNeverSentRows} = useAddNeverSentRows();
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  // The rows of the add on its way, so its button shows it and the others wait.
  const [adding, setAdding] = useState<readonly string[] | null>(null);
  const [shown, setShown] = useState(GROUPS_PAGE);

  if (isPending)
    return (
      <ul
        role='status'
        aria-label='Loading the rows your bank never sent'
        className='grid grid-cols-1'
      >
        <TileRowsSkeleton count={Math.min(summary.rowsNotInBank, 4) || 1} />
      </ul>
    );
  if (isError)
    return (
      <LoadErrorState
        size='section'
        title="Couldn't load these rows"
        error={error}
        onRetry={refetch}
      />
    );

  const add = async (ids: string[]) => {
    setAdding(ids);
    try {
      await addNeverSentRows({importId: summary.id, rowIds: ids});
      setAdded((current) => new Set([...current, ...ids]));
    } catch (failure) {
      if (!wasToasted(failure))
        toast.error(
          ids.length === 1
            ? "Couldn't add the transaction"
            : `Couldn't add ${plural(ids.length, 'transaction')}`,
          {description: 'Try again in a moment.', id: `bank-import-add-failed-${summary.id}`},
        );
      // Another tab may have added a row or undone the import: show what is still open.
      if (failure instanceof HttpError && [404, 409].includes(failure.status)) void refetch();
    } finally {
      setAdding(null);
    }
  };

  const groups = neverSentGroups(rows);
  const more = Math.min(GROUPS_PAGE, groups.length - shown);
  return (
    <div className='grid grid-cols-1 gap-3'>
      <p className='text-sm text-muted-foreground'>
        Your bank&apos;s sync has every transaction of these days, and none of these. Add any you
        know are real.
      </p>
      <ul className='grid grid-cols-1 gap-3'>
        {groups.slice(0, shown).map((group) => (
          <Group
            key={group.key}
            group={group}
            added={added}
            adding={adding}
            onAdd={(ids) => void add(ids)}
          />
        ))}
      </ul>
      {more > 0 && (
        <Button
          variant='ghost'
          className='w-full text-muted-foreground max-sm:h-11'
          onClick={() => setShown(shown + GROUPS_PAGE)}
        >
          Show {formatCount(more)} more
        </Button>
      )}
    </div>
  );
}

function Group({
  group,
  added,
  adding,
  onAdd,
}: {
  group: NeverSentGroup;
  added: ReadonlySet<string>;
  adding: readonly string[] | null;
  onAdd: (ids: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  const open = group.rows.filter(({id}) => !added.has(id)).map(({id}) => id);
  const addingGroup =
    adding !== null && adding.length > 1 && adding.every((id) => open.includes(id));
  const rows = all ? group.rows : group.rows.slice(0, GROUP_ROWS);
  return (
    <li
      className='grid grid-cols-1 overflow-hidden rounded-md border'
      data-testid='bank-import-never-sent-group'
    >
      <div className='grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3'>
        <span aria-hidden='true' className={IMPORT_TILE}>
          <FileX strokeWidth={2} />
        </span>
        <span className='min-w-0'>
          <span className='line-clamp-2 text-sm wrap-anywhere'>{group.label}</span>
          <span className='block truncate text-xs text-muted-foreground'>
            {plural(group.rows.length, 'row')}
          </span>
        </span>
        {open.length > 1 ? (
          <Button
            variant='outline'
            size='sm'
            disabled={adding !== null}
            aria-label={
              addingGroup ? undefined : `Add ${formatCount(open.length)} from ${group.label}`
            }
            onClick={() => onAdd(open)}
            className='max-sm:h-11'
          >
            {addingGroup ? <PendingLabel>Adding…</PendingLabel> : `Add ${formatCount(open.length)}`}
          </Button>
        ) : (
          <span />
        )}
      </div>
      <ul className='grid grid-cols-1 divide-y border-t'>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            groupLabel={group.label}
            added={added.has(row.id)}
            adding={adding?.length === 1 && adding[0] === row.id}
            disabled={adding !== null}
            onAdd={() => onAdd([row.id])}
          />
        ))}
      </ul>
      {!all && group.rows.length > GROUP_ROWS && (
        <Button
          variant='ghost'
          className='rounded-none border-t text-muted-foreground max-sm:h-11'
          onClick={() => setAll(true)}
        >
          Show all {formatCount(group.rows.length)}
        </Button>
      )}
    </li>
  );
}

function Row({
  row,
  groupLabel,
  added,
  adding,
  disabled,
  onAdd,
}: {
  row: BankImportNeverSentRow;
  groupLabel: string;
  added: boolean;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const title = neverSentRowTitle(row);
  const date = formatBankTransactionCompactDate(row.row.bookingDate ?? row.row.valueDate);
  // The group's name already says it: the row shows its day alone.
  const sameAsGroup = title.toLocaleLowerCase() === groupLabel.toLocaleLowerCase();
  return (
    <li className='grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2'>
      <span className='min-w-0'>
        <span className='line-clamp-2 text-sm wrap-anywhere'>{sameAsGroup ? date : title}</span>
        {!sameAsGroup && (
          <span className='block truncate text-xs text-muted-foreground'>{date}</span>
        )}
      </span>
      <span className='text-right text-sm'>
        <CurrencyAmount amount={Number(row.row.amount)} currency={row.row.currency} />
      </span>
      {added ? (
        <span role='status' className='min-w-16 text-right text-sm text-muted-foreground'>
          Added
        </span>
      ) : (
        <Button
          variant='ghost'
          size='sm'
          disabled={disabled}
          aria-label={adding ? undefined : `Add ${title} on ${date}`}
          onClick={onAdd}
          className='min-w-16 max-sm:h-11'
        >
          {adding ? <PendingLabel>Adding…</PendingLabel> : 'Add'}
        </Button>
      )}
    </li>
  );
}
