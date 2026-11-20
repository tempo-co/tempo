import type {
  BankImportNeverSentKind,
  BankImportNeverSentRow,
  BankImportSummary,
} from '@tempo/contracts';
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
  useRefreshNeverSentRows,
} from '../api/use-bank-import-never-sent-rows';
import {formatCount, plural} from '../utils/import-format';
import {
  NEVER_SENT_COPY,
  type NeverSentGroup,
  neverSentCount,
  neverSentGroups,
  neverSentRowTitle,
} from '../utils/never-sent-rows';
import {IMPORT_TILE} from './file-choice';

/** How many groups show at first, and how many more each Show more adds; and the rows a group shows before Show all. */
const GROUPS_PAGE = 50;
/** A group's Add and each row's Add: one small outline button of a shared minimum width, in one right-hand column. */
const ADD_ACTION = 'min-w-20 max-sm:h-11';
const GROUP_ROWS = 5;

/**
 * The import's rows on days bank sync is final for that the bank never sent, of one kind: left out by the import, or
 * removed by a later sync. One folded line, which opens a list grouped by counterparty (else description), so a kind
 * of payment the bank leaves out shows as one group. Each row and each group can be added (back); nothing adds every
 * row at once. Added rows stay listed as added.
 */
export function NeverSentRows({
  summary,
  kind,
  added,
  onAdded,
}: {
  summary: BankImportSummary;
  kind: BankImportNeverSentKind;
  /** The rows added from this summary, in either kind's list. */
  added: ReadonlySet<string>;
  onAdded: (ids: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = neverSentCount(summary, kind);
  // Opened once in this summary, the list stays so its added rows can show as added.
  if (count === 0 && !open) return null;
  return (
    <section
      className='grid grid-cols-1 gap-3'
      data-testid={
        kind === 'not_in_bank' ? 'bank-import-never-sent' : 'bank-import-removed-by-sync'
      }
    >
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
        {NEVER_SENT_COPY[kind].line(count)}
      </Button>
      {open && (
        <div id={listId}>
          <NeverSentList summary={summary} kind={kind} added={added} onAdded={onAdded} />
        </div>
      )}
    </section>
  );
}

function NeverSentList({
  summary,
  kind,
  added,
  onAdded,
}: {
  summary: BankImportSummary;
  kind: BankImportNeverSentKind;
  added: ReadonlySet<string>;
  onAdded: (ids: readonly string[]) => void;
}) {
  const copy = NEVER_SENT_COPY[kind];
  const {
    data: allRows,
    error,
    isPending,
    isError,
    refetch,
  } = useBankImportNeverSentRows(summary.id, true);
  const {addNeverSentRows} = useAddNeverSentRows();
  const refreshRows = useRefreshNeverSentRows(summary.id);
  // The rows of the add on its way, so its button shows it and the others wait.
  const [adding, setAdding] = useState<readonly string[] | null>(null);
  const [shown, setShown] = useState(GROUPS_PAGE);

  if (isPending)
    return (
      <ul role='status' aria-label={copy.loading} className='grid grid-cols-1'>
        <TileRowsSkeleton count={Math.min(neverSentCount(summary, kind), 4) || 1} />
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
    // A group sent in several requests can fail partway: the rows already added show as added.
    const landed = new Set<string>();
    try {
      await addNeverSentRows({
        importId: summary.id,
        rowIds: ids,
        onAdded: (chunk) => {
          for (const id of chunk) landed.add(id);
          onAdded(chunk);
        },
      });
    } catch (failure) {
      const notAdded = ids.length - landed.size;
      if (!wasToasted(failure))
        toast.error(copy.failed(notAdded), {
          description: 'Try again in a moment.',
          id: `bank-import-add-failed-${summary.id}`,
        });
      // Another tab may have added a row or undone the import: show what is still open.
      if (failure instanceof HttpError && [404, 409].includes(failure.status))
        void refreshRows(new Set([...added, ...landed])).catch(() => undefined);
    } finally {
      setAdding(null);
    }
  };

  // Both lists of an import share one read; each shows its own kind.
  const groups = neverSentGroups(allRows.filter((row) => row.kind === kind));
  const more = Math.min(GROUPS_PAGE, groups.length - shown);
  return (
    <div className='grid grid-cols-1 gap-3'>
      <p className='text-sm text-muted-foreground'>{copy.intro}</p>
      <ul className='grid grid-cols-1 gap-3'>
        {groups.slice(0, shown).map((group) => (
          <Group
            key={group.key}
            kind={kind}
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
  kind,
  group,
  added,
  adding,
  onAdd,
}: {
  kind: BankImportNeverSentKind;
  group: NeverSentGroup;
  added: ReadonlySet<string>;
  adding: readonly string[] | null;
  onAdd: (ids: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  const open = group.rows.filter(({id}) => !added.has(id)).map(({id}) => id);
  // Rows of a group sent in several requests show as added as each lands, so the group stays pending by its rows.
  const addingGroup =
    adding !== null &&
    adding.length > 1 &&
    adding.every((id) => group.rows.some((row) => row.id === id));
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
        {open.length > 1 || addingGroup ? (
          <Button
            variant='outline'
            size='sm'
            disabled={adding !== null}
            aria-label={
              addingGroup
                ? undefined
                : `${NEVER_SENT_COPY[kind].add} ${formatCount(open.length)} from ${group.label}`
            }
            onClick={() => onAdd(open)}
            className={ADD_ACTION}
          >
            {addingGroup ? (
              <PendingLabel>{NEVER_SENT_COPY[kind].adding}</PendingLabel>
            ) : (
              `${NEVER_SENT_COPY[kind].add} ${formatCount(open.length)}`
            )}
          </Button>
        ) : (
          <span />
        )}
      </div>
      <ul className='grid grid-cols-1 divide-y border-t'>
        {rows.map((row) => (
          <Row
            key={row.id}
            kind={kind}
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
  kind,
  row,
  groupLabel,
  added,
  adding,
  disabled,
  onAdd,
}: {
  kind: BankImportNeverSentKind;
  row: BankImportNeverSentRow;
  groupLabel: string;
  added: boolean;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const copy = NEVER_SENT_COPY[kind];
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
        <span role='status' className='min-w-20 text-right text-sm text-muted-foreground'>
          {copy.added}
        </span>
      ) : (
        <Button
          variant='outline'
          size='sm'
          disabled={disabled}
          aria-label={adding ? undefined : `${copy.add} ${title} on ${date}`}
          onClick={onAdd}
          className={ADD_ACTION}
        >
          {adding ? <PendingLabel>{copy.adding}</PendingLabel> : copy.add}
        </Button>
      )}
    </li>
  );
}
