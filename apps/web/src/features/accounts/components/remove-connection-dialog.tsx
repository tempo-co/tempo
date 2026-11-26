import {useIsMutating} from '@tanstack/react-query';
import type {BankConnection} from '@tempo/contracts';
import {useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  DELETE_BANK_CONNECTION_KEY,
  useDeleteBankConnection,
} from '@/features/banking/api/use-delete-bank-connection';
import {useBankConnectionRefreshState} from '@/features/banking/api/use-refresh-bank-connection';
import {isFileConnection, isSyncInProgress} from '@/features/banking/utils/bank-sync-status';
import {wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';

import {connectionName} from '../utils/account-labels';

const DESTRUCTIVE_CONNECTION_STATUSES = ['AUTHORIZED', 'EXPIRED'] as const;
export const SYNC_IN_PROGRESS_REMOVAL =
  'Bank sync is in progress. Wait for it to finish before removing this connection.';

/**
 * Removes a connection after asking. A bank with accounts offers to keep them and their history as imported files
 * or to delete everything; imported files and a bank holding nothing are deleted outright.
 */
export function RemoveConnectionDialog({
  connection,
  open,
  onOpenChange,
  onRemoved,
}: {
  connection: BankConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `kept`: its accounts stay, now as imported files. */
  onRemoved: (removal: {kept: boolean}) => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className='md:w-120'>
        {/* While it fades out, the dialog shows its bank but takes no more input; every opening starts afresh. */}
        <div inert={!open} className='contents'>
          <RemoveStep
            key={String(open)}
            connection={connection}
            onCancel={() => onOpenChange(false)}
            onRemoved={onRemoved}
          />
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function RemoveStep({
  connection,
  onCancel,
  onRemoved,
}: {
  connection: BankConnection;
  onCancel: () => void;
  onRemoved: (removal: {kept: boolean}) => void;
}) {
  const [keepAccounts, setKeepAccounts] = useState(true);
  const {deleteBankConnection, isPending: isDeleting} = useDeleteBankConnection();
  // A removal started before the dialog was closed and reopened is still this connection's.
  const isPending =
    useIsMutating({
      mutationKey: DELETE_BANK_CONNECTION_KEY,
      predicate: ({state}) =>
        (state.variables as {connectionId?: string} | undefined)?.connectionId === connection.id,
    }) > 0 || isDeleting;
  const {isPending: isRefreshing} = useBankConnectionRefreshState(connection.id);
  const destructive = (DESTRUCTIVE_CONNECTION_STATUSES as readonly string[]).includes(
    connection.status,
  );
  const accountCount = connection.bankAccounts.length;
  const accountsPhrase =
    accountCount === 1 ? 'account and its' : `${accountCount} accounts and their`;
  // Keeping is a choice only for a bank with accounts; imported files have nowhere else to go.
  // Choosing to delete confirms it.
  const choosing = destructive && accountCount > 0 && !isFileConnection(connection);
  const keeping = choosing && keepAccounts;
  const confirmingDelete = destructive && !keeping;
  const blocked = isRefreshing || isSyncInProgress(connection);
  const canConfirm = !isPending && !blocked;

  const remove = async () => {
    if (!canConfirm) return;
    try {
      await deleteBankConnection(
        connection.id,
        keeping ? {keepAccounts: true} : confirmingDelete ? {confirmation: 'DELETE'} : {},
      );
      toast.success('Bank connection removed', {id: `bank-connection-removed-${connection.id}`});
      onRemoved({kept: keeping});
    } catch (error) {
      if (wasToasted(error)) return;
      toast.error('Unable to remove bank connection', {
        description: 'Try again in a moment.',
        id: `bank-connection-remove-failed-${connection.id}`,
      });
    }
  };

  const choices = [
    {
      keep: true,
      title: 'Keep accounts and history',
      detail: `Syncing stops. Your ${accountsPhrase} transactions stay, and you can add statement files.`,
    },
    {
      keep: false,
      title: 'Delete everything',
      detail: `Permanently deletes the ${accountsPhrase} transactions. This cannot be undone.`,
    },
  ];

  return (
    <>
      <ResponsiveDialogHeader className='text-start'>
        <ResponsiveDialogTitle>Remove {connectionName(connection)}?</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className='pt-2'>
          {choosing
            ? 'The bank’s access ends. Choose what happens to its accounts.'
            : accountCount > 0
              ? `This permanently deletes the connection and the ${accountsPhrase} transactions. This cannot be undone.`
              : 'This permanently deletes the connection. This cannot be undone.'}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <form
          className='grid items-start gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          {choosing && (
            <fieldset className='grid min-w-0 gap-2' disabled={isPending}>
              <legend className='sr-only'>What happens to the accounts</legend>
              <div className='divide-y overflow-hidden rounded-md border'>
                {choices.map((choice) => {
                  const checked = keepAccounts === choice.keep;
                  return (
                    <label
                      key={choice.title}
                      className={cn(
                        'grid min-h-15 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-3 py-3 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring',
                        checked && 'bg-accent/60',
                      )}
                    >
                      <input
                        type='radio'
                        name={`remove-bank-choice-${connection.id}`}
                        checked={checked}
                        onChange={() => setKeepAccounts(choice.keep)}
                        className='sr-only'
                      />
                      <span
                        aria-hidden='true'
                        className={cn(
                          'mt-0.5 grid size-4 place-items-center rounded-full border border-muted-foreground',
                          checked && 'border-primary',
                        )}
                      >
                        {checked && <span className='size-2 rounded-full bg-primary' />}
                      </span>
                      <span className='min-w-0'>
                        <span className='block text-body font-medium'>{choice.title}</span>
                        <span className='block text-body-small text-muted-foreground'>
                          {choice.detail}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {blocked && !isPending && (
            <p role='status' className='text-body-small text-muted-foreground'>
              {SYNC_IN_PROGRESS_REMOVAL}
            </p>
          )}
          <div className='mt-2 flex flex-col justify-end gap-4 pb-4 md:flex-row md:pb-0'>
            <Button
              type='submit'
              variant={keeping ? 'default' : 'destructive'}
              disabled={!canConfirm}
              data-testid={`remove-bank-confirm-${connection.id}`}
              className='order-1 md:order-2'
            >
              {isPending ? (
                <PendingLabel>Removing...</PendingLabel>
              ) : keeping ? (
                'Remove connection'
              ) : (
                'Remove permanently'
              )}
            </Button>
            <Button
              variant='outline'
              type='button'
              onClick={onCancel}
              className='order-2 md:order-1'
            >
              Cancel
            </Button>
          </div>
        </form>
      </ResponsiveDialogBody>
    </>
  );
}
