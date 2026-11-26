import type {BankImportSummary} from '@tempo/contracts';
import {FileUp} from 'lucide-react';
import {type MouseEvent, useState} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Bone, TextBone} from '@/features/dashboard/components/loading';
import {ConfirmActionDialog} from '@/features/settings/components/session/confirm-action-dialog';
import {cn} from '@/utils/cn';

import type {useBankImports} from '../api/use-bank-imports';
import {
  formatImportedDay,
  formatShortDate,
  importHeadline,
  needALook,
} from '../utils/import-format';
import {IMPORT_TILE} from '../utils/import-tile';
import {importAccountName, useKnownAccounts} from './use-known-accounts';
import {UNDO_FAILED, useUndoImport} from './use-undo-import';

/** How many imports show before Show all. */
const SHOWN = 5;
/** The settings-list row: 16px each side, so the always-visible action keeps its 16px too. */
const ROW = 'grid min-h-15 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2';

/**
 * The owner's imports, newest first: shown once there is one. An undone import stays listed. A row opens its summary;
 * Review opens the rows still to check; Undo asks first. With `accountId`, only the imports that wrote to that account.
 */
export function ImportsList({
  query,
  onOpen,
  onReview,
  accountId,
  title = 'Imports',
}: {
  query: ReturnType<typeof useBankImports>;
  /** `event` is the click, whose button focus returns to. */
  onOpen: (summary: BankImportSummary, event: MouseEvent<HTMLElement>) => void;
  onReview: (summary: BankImportSummary, event: MouseEvent<HTMLElement>) => void;
  accountId?: string;
  title?: string;
}) {
  const {data: all, error, isError, isFetching, refetch} = query;
  const [showAll, setShowAll] = useState(false);
  const imports =
    accountId && all
      ? all.filter((summary) => summary.accounts.some(({id}) => id === accountId))
      : all;

  if (!imports) {
    // Import is on but the list failed: the cards above stay; this section says so and retries.
    if (!isError && !isFetching) return null;
    return (
      <ImportsSection title={title}>
        {isFetching ? (
          <ul
            role='status'
            aria-label='Loading imports'
            className='divide-y overflow-hidden rounded-lg border bg-card'
          >
            <ImportRowSkeleton />
            <ImportRowSkeleton />
          </ul>
        ) : (
          <LoadErrorState
            size='section'
            title="Couldn't load your imports"
            error={error}
            onRetry={refetch}
          />
        )}
      </ImportsSection>
    );
  }
  if (imports.length === 0) return null;
  const shown = showAll ? imports : imports.slice(0, SHOWN);

  return (
    <ImportsSection title={title}>
      <ul
        className='divide-y overflow-hidden rounded-lg border bg-card'
        data-testid='bank-imports-list'
      >
        {shown.map((summary) => (
          <ImportRow
            key={summary.id}
            summary={summary}
            onOpen={(event) => onOpen(summary, event)}
            onReview={(event) => onReview(summary, event)}
          />
        ))}
      </ul>
      {!showAll && imports.length > SHOWN && (
        <Button
          variant='ghost'
          className='mt-1 w-full text-muted-foreground max-sm:h-11'
          onClick={() => setShowAll(true)}
        >
          Show all
        </Button>
      )}
    </ImportsSection>
  );
}

function ImportsSection({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section aria-labelledby='bank-imports-heading' className='grid grid-cols-1'>
      <h2 id='bank-imports-heading' className='mb-3 text-card-title'>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ImportRow({
  summary,
  onOpen,
  onReview,
}: {
  summary: BankImportSummary;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onReview: (event: MouseEvent<HTMLElement>) => void;
}) {
  const known = useKnownAccounts();
  const {undoOrThrow, describe, isPending} = useUndoImport();
  const undone = !!summary.undoneAt;
  const day = formatShortDate(summary.createdAt);
  const details = undone
    ? [`Undone ${formatShortDate(summary.undoneAt!)}`]
    : [
        formatImportedDay(summary.createdAt),
        summary.accounts.map((account) => importAccountName(account, known)).join(', '),
      ].filter(Boolean);

  return (
    <li
      className={cn('relative hover:bg-accent/50', undone && 'text-muted-foreground')}
      data-testid='bank-import-row'
    >
      <div className={ROW}>
        <span aria-hidden='true' className={cn(IMPORT_TILE, undone && 'opacity-60')}>
          <FileUp strokeWidth={2} />
        </span>
        <span className='min-w-0'>
          {/* The whole row opens the summary; Undo sits above this button's area. */}
          <button
            type='button'
            onClick={onOpen}
            className='block w-full truncate text-left text-body after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring'
          >
            {importHeadline(summary)}
          </button>
          <span className='block truncate text-body-small text-muted-foreground'>
            {details.join(' · ')}
            {!undone && summary.rowsDoubtful > 0 && (
              <>
                {' · '}
                <span className='text-warning'>{needALook(summary.rowsDoubtful)}</span>
              </>
            )}
          </span>
        </span>
        {!undone && (
          <span className='flex gap-2'>
            {summary.rowsDoubtful > 0 && (
              <Button
                variant='outline'
                size='sm'
                onClick={onReview}
                aria-label={`Review import from ${day}`}
                className='relative max-sm:h-11'
              >
                Review
              </Button>
            )}
            <ConfirmActionDialog
              trigger={
                <Button
                  variant='outline'
                  size='sm'
                  aria-label={`Undo import from ${day}`}
                  className='relative max-sm:h-11'
                >
                  Undo
                </Button>
              }
              title='Undo this import?'
              description={describe(summary)}
              confirmLabel='Undo import'
              pendingLabel='Undoing…'
              confirmVariant='destructive'
              confirmTestId={`bank-import-undo-confirm-${summary.id}`}
              isPending={isPending}
              onConfirm={() => undoOrThrow(summary)}
              failureMessage={`${UNDO_FAILED}. Try again in a moment.`}
            />
          </span>
        )}
      </div>
    </li>
  );
}

/** An import row while the list loads, in the loaded row's height. */
function ImportRowSkeleton() {
  return (
    <li aria-hidden='true' className={ROW}>
      <Bone className='size-9 rounded-full' />
      <span className='min-w-0'>
        <span className='block text-body'>
          <TextBone className='w-[9em]' />
        </span>
        <span className='block text-body-small'>
          <TextBone className='w-[14em]' />
        </span>
      </span>
      <Bone className='h-9 w-16 rounded-md max-sm:h-11' />
    </li>
  );
}
