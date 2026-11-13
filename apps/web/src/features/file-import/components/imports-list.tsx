import type {BankImportSummary} from '@tempo/contracts';
import {FileUp} from 'lucide-react';
import {useState} from 'react';

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
import {IMPORT_TILE} from './file-choice';
import {importAccountName, useKnownAccounts} from './use-known-accounts';
import {useUndoImport} from './use-undo-import';

/** How many imports show before Show all. */
const SHOWN = 5;
/** The settings-list row: 16px each side, so the always-visible action keeps its 16px too. */
const ROW = 'grid min-h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3';

/**
 * The owner's imports, newest first, under the connection cards: shown once there is one. An undone import stays
 * listed. A row opens its summary; Undo asks first.
 */
export function ImportsList({
  query,
  onOpen,
}: {
  query: ReturnType<typeof useBankImports>;
  onOpen: (summary: BankImportSummary) => void;
}) {
  const {data: imports, error, isError, isFetching, refetch} = query;
  const [showAll, setShowAll] = useState(false);

  if (!imports) {
    // Import is on but the list failed: the cards above stay; this section says so and retries.
    if (!isError && !isFetching) return null;
    return (
      <ImportsSection>
        {isFetching ? (
          <ul
            role='status'
            aria-label='Loading imports'
            className='divide-y overflow-hidden rounded-card border bg-card'
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
    <ImportsSection>
      <ul
        className='divide-y overflow-hidden rounded-card border bg-card'
        data-testid='bank-imports-list'
      >
        {shown.map((summary) => (
          <ImportRow key={summary.id} summary={summary} onOpen={() => onOpen(summary)} />
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

function ImportsSection({children}: {children: React.ReactNode}) {
  return (
    <section aria-labelledby='bank-imports-heading' className='grid grid-cols-1'>
      <h2 id='bank-imports-heading' className='mb-3 text-card-title'>
        Imports
      </h2>
      {children}
    </section>
  );
}

function ImportRow({summary, onOpen}: {summary: BankImportSummary; onOpen: () => void}) {
  const known = useKnownAccounts();
  const {undo, describe, isPending} = useUndoImport();
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
            className='block w-full truncate text-left text-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring'
          >
            {importHeadline(summary)}
          </button>
          <span className='block truncate text-xs text-muted-foreground'>
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
            onConfirm={() => undo(summary)}
          />
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
        <span className='block text-sm'>
          <TextBone className='w-[9em]' />
        </span>
        <span className='block text-xs'>
          <TextBone className='w-[14em]' />
        </span>
      </span>
      <Bone className='h-9 w-16 rounded-md max-sm:h-11' />
    </li>
  );
}
