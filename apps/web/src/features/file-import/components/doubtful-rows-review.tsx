import type {
  BankImportDoubtfulCandidate,
  BankImportDoubtfulRow,
  BankImportSummary,
  ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';
import {CheckCheck, FileQuestion} from 'lucide-react';
import {useRef, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {MerchantLogoTile} from '@/features/banking/components/merchant-logo-tile';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {HttpError, wasToasted} from '@/utils/api';

import {
  useBankImportDoubtfulRows,
  useResolveDoubtfulRow,
} from '../api/use-bank-import-doubtful-rows';
import {IMPORT_TILE} from './file-choice';

/** The shared 60px row shape, as a plain row: these rows open nothing. */
const ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3';

type Answer = {decision: ResolveBankImportDoubtfulRowRequest['decision']; pending: boolean};

/**
 * The import's rows held for the owner: each next to the stored transactions it could be. Each answer is final
 * (the API cannot change it), and the block collapses to a line saying what was chosen.
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
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  // Answers can land in any order, so the latest set is kept outside render too.
  const latest = useRef(answers);
  const answer = (rowId: string, value: Answer | null) => {
    const rest = Object.fromEntries(Object.entries(latest.current).filter(([id]) => id !== rowId));
    latest.current = value ? {...rest, [rowId]: value} : rest;
    setAnswers(latest.current);
  };

  const resolve = async (
    row: BankImportDoubtfulRow,
    request: ResolveBankImportDoubtfulRowRequest,
  ) => {
    answer(row.id, {decision: request.decision, pending: true});
    try {
      const next = await resolveDoubtfulRow({importId: summary.id, rowId: row.id, ...request});
      answer(row.id, {decision: request.decision, pending: false});
      onSummary(next);
      if (rows?.every(({id}) => latest.current[id] && !latest.current[id].pending)) onDone(next);
    } catch (failure) {
      answer(row.id, null);
      if (wasToasted(failure)) return;
      toast.error("Couldn't save your answer", {
        description: 'Please try again in a moment.',
        id: `bank-import-resolve-failed-${row.id}`,
      });
      // Another tab may have answered it or the import may be gone: show what is still open.
      if (failure instanceof HttpError && [404, 409].includes(failure.status)) void refetch();
    }
  };

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

  return (
    <ol className='grid grid-cols-1 divide-y' data-testid='bank-import-review'>
      {rows.map((row) => (
        <DoubtfulRowBlock
          key={row.id}
          row={row}
          answer={answers[row.id]}
          onResolve={(request) => void resolve(row, request)}
        />
      ))}
    </ol>
  );
}

function DoubtfulRowBlock({
  row,
  answer,
  onResolve,
}: {
  row: BankImportDoubtfulRow;
  answer: Answer | undefined;
  onResolve: (request: ResolveBankImportDoubtfulRowRequest) => void;
}) {
  const {row: fileRow} = row;
  const title = fileRow.description || fileRow.counterpartyName || 'Transaction';
  const date = formatBankTransactionCompactDate(fileRow.bookingDate ?? fileRow.valueDate);
  const pending = !!answer?.pending;
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <li className='grid grid-cols-1 py-2' data-testid='bank-import-doubtful-row'>
      <div className={ROW}>
        <span aria-hidden='true' className={IMPORT_TILE}>
          <FileQuestion strokeWidth={2} />
        </span>
        <span className='min-w-0'>
          <span className='block truncate text-sm'>{title}</span>
          <span className='block truncate text-xs text-muted-foreground'>
            {date} · from the file
          </span>
        </span>
        <span className='text-sm'>
          <CurrencyAmount amount={Number(fileRow.amount)} currency={fileRow.currency} />
        </span>
      </div>
      {answer && !pending ? (
        <p role='status' className='pb-2 text-sm text-muted-foreground'>
          {answer.decision === 'new' ? 'Kept as new' : 'Marked as the same'}
        </p>
      ) : (
        <div className='grid grid-cols-1 gap-1 pb-2'>
          {row.candidates.length > 0 && (
            <>
              <p className='text-xs text-muted-foreground'>Could be the same as</p>
              <ul className='grid grid-cols-1'>
                {row.candidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    disabled={pending}
                    pending={pending && answer?.decision === 'duplicate' && chosen === candidate.id}
                    onSame={() => {
                      setChosen(candidate.id);
                      onResolve({decision: 'duplicate', transactionId: candidate.id});
                    }}
                  />
                ))}
              </ul>
            </>
          )}
          <Button
            variant='ghost'
            size='sm'
            disabled={pending}
            onClick={() => onResolve({decision: 'new'})}
            className='-ml-3 justify-self-start'
          >
            {pending && answer?.decision === 'new' ? (
              <PendingLabel>Saving…</PendingLabel>
            ) : (
              "It's a new transaction"
            )}
          </Button>
        </div>
      )}
    </li>
  );
}

function CandidateRow({
  candidate,
  disabled,
  pending,
  onSame,
}: {
  candidate: BankImportDoubtfulCandidate;
  disabled: boolean;
  pending: boolean;
  onSame: () => void;
}) {
  const title = candidate.displayDescription || candidate.counterpartyName || 'Transaction';
  const date = formatBankTransactionCompactDate(
    candidate.transactionDate ?? candidate.bookingDate ?? candidate.valueDate,
  );
  return (
    <li className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto_auto]'>
      <MerchantLogoTile
        transaction={{merchantLogoUrl: null, category: null, cashFlowTreatment: 'UNKNOWN'}}
      />
      <span className='min-w-0'>
        <span className='block truncate text-sm'>{title}</span>
        <span className='block truncate text-xs text-muted-foreground'>{date}</span>
      </span>
      <span className='text-sm'>
        <CurrencyAmount amount={Number(candidate.amount)} currency={candidate.currency} />
      </span>
      <Button
        variant='outline'
        size='sm'
        disabled={disabled}
        onClick={onSame}
        aria-label={`Same transaction as ${title} on ${date}`}
        className='col-span-3 mt-2 w-full md:col-span-1 md:mt-0 md:w-auto'
      >
        {pending ? <PendingLabel>Saving…</PendingLabel> : 'Same transaction'}
      </Button>
    </li>
  );
}
