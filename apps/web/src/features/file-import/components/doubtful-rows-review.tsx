import type {
  BankImportDoubtfulCandidate,
  BankImportDoubtfulRow,
  BankImportSummary,
  ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';
import {differenceInCalendarDays, parseISO} from 'date-fns';
import {CheckCheck, CircleAlert, FilePlus, FileQuestion} from 'lucide-react';
import {type ReactNode, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {HttpError, wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';

import {
  useBankImportDoubtfulRows,
  useResolveDoubtfulRow,
} from '../api/use-bank-import-doubtful-rows';
import {formatCount, plural} from '../utils/import-format';
import {IMPORT_TILE} from './file-choice';

/**
 * One grid for the file row and every choice under it: a 36px lead (the file row's tile, or a choice's radio), the
 * text, and the amount. The amounts share one right-aligned column and nothing sits after them.
 */
const ROW = 'grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3';

type Pick = ResolveBankImportDoubtfulRowRequest;

const samePick = (a: Pick | undefined, b: Pick) =>
  a?.decision === b.decision && a.transactionId === b.transactionId;

const candidateTitle = (candidate: BankImportDoubtfulCandidate) =>
  candidate.displayDescription || candidate.counterpartyName || 'Transaction';

const candidateDate = (candidate: BankImportDoubtfulCandidate) =>
  candidate.transactionDate ?? candidate.bookingDate ?? candidate.valueDate;

/** How a stored row's day sits against the file row's: `same day`, `2 days earlier`. */
function dayGap(date: string | null, fileDate: string | null) {
  if (!date || !fileDate) return null;
  const days = differenceInCalendarDays(parseISO(date), parseISO(fileDate));
  if (Number.isNaN(days)) return null;
  if (days === 0) return 'same day';
  return `${plural(Math.abs(days), 'day')} ${days > 0 ? 'later' : 'earlier'}`;
}

/**
 * The import's rows held for the owner: each next to the stored transactions it could be, as one choice between
 * them and a new transaction. Choices change freely until Save sends them, one row at a time. A saved answer is
 * final (the API cannot change it) and collapses its block to a line saying what was chosen; a row left without a
 * choice stays open for later.
 */
export function DoubtfulRowsReview({
  summary,
  onSummary,
  onDone,
}: {
  summary: BankImportSummary;
  onSummary: (summary: BankImportSummary) => void;
  onDone: (summary: BankImportSummary) => void;
}) {
  const {data: rows, error, isPending, isError, refetch} = useBankImportDoubtfulRows(summary.id);
  const {resolveDoubtfulRow} = useResolveDoubtfulRow();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [saved, setSaved] = useState<Record<string, Pick>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  if (isPending)
    return (
      <ul role='status' aria-label='Loading transactions to check' className='grid grid-cols-1'>
        <TileRowsSkeleton count={Math.min(summary.rowsDoubtful, 4) || 1} />
      </ul>
    );
  if (isError)
    return (
      <LoadErrorState
        size='section'
        title="Couldn't load the transactions to check"
        error={error}
        onRetry={refetch}
      />
    );

  if (rows.length === 0)
    return (
      <StateMessage
        size='section'
        icon={CheckCheck}
        title='Nothing left to check'
        description='Every transaction in this import has an answer.'
      />
    );

  const unsaved = rows.filter(({id}) => picks[id] && !saved[id]);
  const unanswered = rows.filter(({id}) => !picks[id] && !saved[id]).length;

  const save = async () => {
    setSaving(true);
    setFailed(new Set());
    const done = {...saved};
    const failures: {id: string; failure: unknown}[] = [];
    let latest: BankImportSummary | null = null;
    // One at a time, so the last summary the API answers with is the newest.
    for (const row of unsaved) {
      try {
        latest = await resolveDoubtfulRow({importId: summary.id, rowId: row.id, ...picks[row.id]});
        done[row.id] = picks[row.id];
        setSaved({...done});
        onSummary(latest);
      } catch (failure) {
        failures.push({id: row.id, failure});
        // Offline or signed out: the rest would fail the same way, so they wait with their choices.
        if (wasToasted(failure)) break;
      }
    }
    setSaving(false);
    if (failures.length === 0) {
      if (latest && rows.every(({id}) => done[id])) onDone(latest);
      return;
    }
    setFailed(new Set(failures.map(({id}) => id)));
    if (failures.some(({failure}) => !wasToasted(failure)))
      toast.error(
        failures.length === 1
          ? "Couldn't save your answer"
          : `Couldn't save ${plural(failures.length, 'answer')}`,
        {
          description: 'Try again in a moment.',
          id: `bank-import-resolve-failed-${summary.id}`,
        },
      );
    // Another tab may have answered a row or the import may be gone: show what is still open.
    if (
      failures.some(
        ({failure}) => failure instanceof HttpError && [404, 409].includes(failure.status),
      )
    )
      void refetch();
  };

  return (
    <div className='grid grid-cols-1 gap-4'>
      <p className='text-sm text-muted-foreground'>
        Choose what each one is, then save. You can change a choice until you save it.
      </p>
      <ol className='grid grid-cols-1 gap-4' data-testid='bank-import-review'>
        {rows.map((row) => (
          <DoubtfulRowBlock
            key={row.id}
            row={row}
            pick={picks[row.id]}
            saved={saved[row.id]}
            failed={failed.has(row.id)}
            disabled={saving}
            onPick={(pick) => setPicks((current) => ({...current, [row.id]: pick}))}
          />
        ))}
      </ol>
      {/* Stays in reach at the bottom of the scrolling body, like the dialog's footer. */}
      <div className='sticky bottom-0 -mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-2 border-t bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:-mx-6 md:-mb-6 md:flex-row md:items-center md:justify-end md:px-6 md:pb-4'>
        {unsaved.length > 0 && unanswered > 0 && (
          <p className='text-xs text-muted-foreground md:mr-auto'>
            {unanswered === 1
              ? '1 without an answer stays open'
              : `${formatCount(unanswered)} without an answer stay open`}
          </p>
        )}
        <Button disabled={saving || unsaved.length === 0} onClick={() => void save()}>
          {saving ? (
            <PendingLabel>Saving…</PendingLabel>
          ) : unsaved.length > 1 ? (
            `Save ${plural(unsaved.length, 'answer')}`
          ) : (
            'Save answer'
          )}
        </Button>
      </div>
    </div>
  );
}

function DoubtfulRowBlock({
  row,
  pick,
  saved,
  failed,
  disabled,
  onPick,
}: {
  row: BankImportDoubtfulRow;
  pick: Pick | undefined;
  saved: Pick | undefined;
  failed: boolean;
  disabled: boolean;
  onPick: (pick: Pick) => void;
}) {
  const {row: fileRow} = row;
  const title = fileRow.description || fileRow.counterpartyName || 'Transaction';
  const fileDate = fileRow.bookingDate ?? fileRow.valueDate;
  const date = formatBankTransactionCompactDate(fileDate);
  const name = `bank-import-doubtful-${row.id}`;
  const savedCandidate =
    saved?.decision === 'duplicate'
      ? row.candidates.find(({id}) => id === saved.transactionId)
      : undefined;

  return (
    <li
      className='grid grid-cols-1 overflow-hidden rounded-md border'
      data-testid='bank-import-doubtful-row'
    >
      <div className={cn(ROW, 'py-3')}>
        <span aria-hidden='true' className={IMPORT_TILE}>
          <FileQuestion strokeWidth={2} />
        </span>
        <Title title={title} detail={`${date} · from the file`} />
        <Amount amount={fileRow.amount} currency={fileRow.currency} />
      </div>
      {saved ? (
        <p role='status' className='border-t px-3 py-2 text-sm text-muted-foreground'>
          {saved.decision === 'new'
            ? 'Kept as new'
            : savedCandidate
              ? `Marked as the same as ${candidateTitle(savedCandidate)} on ${formatBankTransactionCompactDate(candidateDate(savedCandidate))}`
              : 'Marked as the same'}
        </p>
      ) : (
        <fieldset className='min-w-0 border-t' disabled={disabled}>
          <legend className='sr-only'>What {title} is</legend>
          <p aria-hidden='true' className='px-3 pt-2 text-xs text-muted-foreground'>
            {row.candidates.length > 0
              ? 'Could be the same as'
              : 'Nothing already in Tempo matches it now'}
          </p>
          {row.candidates.map((candidate) => {
            const day = candidateDate(candidate);
            const dayLabel = formatBankTransactionCompactDate(day);
            const option: Pick = {decision: 'duplicate', transactionId: candidate.id};
            return (
              <Choice
                key={candidate.id}
                name={name}
                label={`Same as ${candidateTitle(candidate)} on ${dayLabel}`}
                checked={samePick(pick, option)}
                onChange={() => onPick(option)}
              >
                <Title
                  title={candidateTitle(candidate)}
                  detail={[dayLabel, dayGap(day, fileDate)].filter(Boolean).join(' · ')}
                />
                <Amount amount={candidate.amount} currency={candidate.currency} />
              </Choice>
            );
          })}
          <Choice
            name={name}
            label="It's a new transaction"
            checked={pick?.decision === 'new'}
            onChange={() => onPick({decision: 'new'})}
            divided={row.candidates.length > 0}
          >
            <span className='flex min-w-0 items-center gap-2 text-sm'>
              <FilePlus aria-hidden='true' className='size-4 shrink-0 text-muted-foreground' />
              It&apos;s a new transaction
            </span>
          </Choice>
          {failed && (
            <p
              role='alert'
              className='flex items-center gap-1.5 border-t px-3 py-2 text-xs text-destructive'
            >
              <CircleAlert aria-hidden='true' className='size-3.5 shrink-0' />
              Couldn&apos;t save this answer. Save to try again.
            </p>
          )}
        </fieldset>
      )}
    </li>
  );
}

/** One answer: a whole-row radio, so the amount keeps its column and arrow keys move between answers. */
function Choice({
  name,
  label,
  checked,
  onChange,
  divided = false,
  children,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        ROW,
        // Relative: the hidden radio sits inside its row, so focusing it scrolls to the row.
        'relative min-h-14 cursor-pointer py-2 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-default',
        checked && 'bg-accent/60',
        divided && 'border-t border-dashed',
      )}
    >
      <input
        type='radio'
        name={name}
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className='sr-only'
      />
      <span
        aria-hidden='true'
        className={cn(
          'grid size-4 place-items-center justify-self-center rounded-full border border-muted-foreground',
          checked && 'border-primary',
        )}
      >
        {checked && <span className='size-2 rounded-full bg-primary' />}
      </span>
      {children}
    </label>
  );
}

function Title({title, detail}: {title: string; detail: string}) {
  return (
    <span className='min-w-0'>
      <span className='line-clamp-2 text-sm wrap-anywhere'>{title}</span>
      <span className='block truncate text-xs text-muted-foreground'>{detail}</span>
    </span>
  );
}

function Amount({amount, currency}: {amount: string; currency: string}) {
  return (
    <span className='text-right text-sm'>
      <CurrencyAmount amount={Number(amount)} currency={currency} />
    </span>
  );
}
