import {useIsMutating} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import {
  BANK_ACCOUNT_ALIAS_MAX_LENGTH,
  type BankAccount,
  type BankConnection,
} from '@tempo/contracts';
import {CircleAlert, Eye, EyeOff, Pencil, Trash2} from 'lucide-react';
import {type ReactNode, useId, useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';

import {
  REMOVE_BANK_ACCOUNT_KEY,
  useRemoveBankAccount,
  useUpdateBankAccount,
} from '../api/use-bank-account-settings';

/**
 * What removing an imported-files account deletes, once its transactions are counted: `imports` is null while the
 * import list is unknown or off.
 */
export type RemovalCounts = {transactions: number; imports: number | null} | null;

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * The account's own settings: Rename, Hide (Show once hidden) and, for an imported-files account, Remove after a
 * confirmation that lists what goes. A synced account is removed with its connection, on the connection card.
 */
export function AccountSettingsCard({
  account,
  connection,
  removalCounts,
}: {
  account: BankAccount;
  connection: BankConnection;
  removalCounts: RemovalCounts;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const {updateBankAccount, isPending, variables} = useUpdateBankAccount();
  const name = accountName(account);
  const hiding = isPending && variables?.isHidden !== undefined;

  /** Hides or shows the account; answers whether it saved, and whether a failure still needs saying. */
  const setHidden = async (isHidden: boolean) => {
    try {
      await updateBankAccount({connectionId: connection.id, accountId: account.id, isHidden});
      return {saved: true, untold: false};
    } catch (error) {
      return {saved: false, untold: !wasToasted(error)};
    }
  };
  // From the card, which stays as it was, a failure is a toast.
  const toggleHidden = async () => {
    const isHidden = !account.isHidden;
    const {untold} = await setHidden(isHidden);
    if (untold)
      toast.error(`Couldn't ${isHidden ? 'hide' : 'show'} ${name}. Try again.`, {
        id: `account-hidden-failed-${account.id}`,
      });
  };

  return (
    <Card
      role='region'
      aria-labelledby='account-settings-heading'
      className='grid grid-cols-1 gap-2 p-4'
      data-testid='account-settings'
    >
      <h2 id='account-settings-heading' className='text-card-title'>
        Settings
      </h2>
      <div className='grid grid-cols-1 gap-2'>
        <SettingsButton icon={<Pencil aria-hidden='true' />} onClick={() => setRenaming(true)}>
          Rename
        </SettingsButton>
        <SettingsButton
          icon={account.isHidden ? <Eye aria-hidden='true' /> : <EyeOff aria-hidden='true' />}
          disabled={hiding}
          onClick={() => void toggleHidden()}
        >
          {hiding ? (
            <PendingLabel>{account.isHidden ? 'Showing…' : 'Hiding…'}</PendingLabel>
          ) : account.isHidden ? (
            'Show in lists and totals'
          ) : (
            'Hide from lists and totals'
          )}
        </SettingsButton>
        {isFileConnection(connection) && (
          <SettingsButton
            icon={<Trash2 aria-hidden='true' />}
            destructive
            onClick={() => setRemoving(true)}
          >
            Remove account
          </SettingsButton>
        )}
      </div>
      <RenameAccountDialog
        account={account}
        connection={connection}
        open={renaming}
        onOpenChange={setRenaming}
      />
      {isFileConnection(connection) && (
        <RemoveAccountDialog
          account={account}
          connection={connection}
          counts={removalCounts}
          open={removing}
          onOpenChange={setRemoving}
          onHideInstead={async () => {
            const result = await setHidden(true);
            if (result.saved) setRemoving(false);
            return result.untold;
          }}
          isHiding={hiding}
        />
      )}
    </Card>
  );
}

function SettingsButton({
  icon,
  destructive,
  children,
  ...props
}: {
  icon: ReactNode;
  destructive?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant='ghost'
      className={cn('justify-start', destructive && 'text-destructive hover:text-destructive')}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
}

/** The owner's name for the account; an empty name goes back to the bank's. */
function RenameAccountDialog({
  account,
  connection,
  open,
  onOpenChange,
}: {
  account: BankAccount;
  connection: BankConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className='md:max-w-md'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Rename account</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            The new name shows wherever this account is named.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Every opening starts from the saved name, never from an abandoned edit. */}
        <RenameForm
          key={String(open)}
          account={account}
          connection={connection}
          onDone={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function RenameForm({
  account,
  connection,
  onDone,
}: {
  account: BankAccount;
  connection: BankConnection;
  onDone: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(account.alias ?? accountName(account));
  const [failed, setFailed] = useState(false);
  const {updateBankAccount, isPending} = useUpdateBankAccount();
  const bankName = accountName({...account, alias: null});

  const save = async () => {
    if (isPending) return;
    const alias = value.trim();
    // The bank's name needs no alias of its own.
    const next = alias === '' || alias === bankName ? null : alias;
    if (next === account.alias) return onDone();
    setFailed(false);
    try {
      await updateBankAccount({connectionId: connection.id, accountId: account.id, alias: next});
      onDone();
    } catch (error) {
      setFailed(!wasToasted(error));
    }
  };

  return (
    <form
      noValidate
      className='grid grid-cols-1 gap-4'
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <ResponsiveDialogBody className='grid grid-cols-1 gap-2'>
        <label htmlFor={`${id}-name`} className='text-body font-medium'>
          Name
        </label>
        <Input
          id={`${id}-name`}
          autoComplete='off'
          autoFocus
          maxLength={BANK_ACCOUNT_ALIAS_MAX_LENGTH}
          value={value}
          disabled={isPending}
          aria-describedby={`${id}-help`}
          onChange={(event) => setValue(event.target.value)}
          className='max-sm:h-12'
        />
        <p id={`${id}-help`} className='text-body-small wrap-anywhere text-muted-foreground'>
          Leave it empty to use the bank’s name, {bankName}.
        </p>
        {failed && <FailedAlert title="Couldn't rename the account" className='mt-2' />}
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className='gap-2'>
        <Button type='submit' disabled={isPending} className='md:order-2'>
          {isPending ? <PendingLabel>Saving…</PendingLabel> : 'Save'}
        </Button>
        <Button type='button' variant='outline' className='md:order-1' onClick={onDone}>
          Cancel
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** A write that failed in the dialog the owner can retry it from. */
function FailedAlert({title, className}: {title: string; className?: string}) {
  return (
    <Alert role='alert' variant='destructive' className={className}>
      <CircleAlert aria-hidden='true' />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>Try again in a moment.</AlertDescription>
    </Alert>
  );
}

/**
 * The plain confirmation for removing an imported-files account: what goes (the account, its transactions, the imports
 * only it holds), that it can't be undone, and Hide it instead.
 */
function RemoveAccountDialog({
  open,
  onOpenChange,
  ...props
}: RemoveStepProps & {open: boolean; onOpenChange: (open: boolean) => void}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className='md:w-120'>
        {/* Every opening starts afresh, without an earlier failure. */}
        <RemoveStep key={String(open)} {...props} onClose={() => onOpenChange(false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type RemoveStepProps = {
  account: BankAccount;
  connection: BankConnection;
  counts: RemovalCounts;
  /** Hides the account instead; answers whether a failure still needs saying. */
  onHideInstead: () => Promise<boolean>;
  isHiding: boolean;
};

function RemoveStep({
  account,
  connection,
  counts,
  onHideInstead,
  isHiding,
  onClose,
}: RemoveStepProps & {onClose: () => void}) {
  const navigate = useNavigate();
  const router = useRouter();
  const name = accountName(account);
  const [failure, setFailure] = useState<'remove' | 'hide' | null>(null);
  const {removeBankAccount, isPending: isRemoving} = useRemoveBankAccount();
  // A removal started before the dialog was closed and reopened is still this account's.
  const isPending =
    useIsMutating({
      mutationKey: REMOVE_BANK_ACCOUNT_KEY,
      predicate: ({state}) =>
        (state.variables as {accountId?: string} | undefined)?.accountId === account.id,
    }) > 0 || isRemoving;

  const remove = async () => {
    if (isPending || !counts) return;
    setFailure(null);
    try {
      await removeBankAccount({connectionId: connection.id, accountId: account.id});
    } catch (error) {
      if (!wasToasted(error)) setFailure('remove');
      return;
    }
    toast.success(
      counts.transactions > 0
        ? `${name} removed with its ${plural(counts.transactions, 'transaction', 'transactions')}`
        : `${name} removed`,
      {id: `account-removed-${account.id}`},
    );
    onClose();
    // The account is gone, so its page is; once the owner has moved on, the removal's end takes them nowhere.
    if (router.matchRoute({to: '/accounts/$accountId', params: {accountId: account.id}}))
      void navigate({to: '/accounts', replace: true});
  };

  const hideInstead = async () => {
    setFailure(null);
    if (await onHideInstead()) setFailure('hide');
  };

  const facts = [
    {label: 'The account', value: name},
    {
      label: 'Transactions',
      value: counts ? counts.transactions.toLocaleString() : '…',
    },
    counts?.imports !== null && {
      label: 'Imports',
      value: counts ? counts.imports.toLocaleString() : '…',
    },
  ].filter((fact) => !!fact);

  return (
    <>
      <ResponsiveDialogHeader className='text-start'>
        <ResponsiveDialogTitle className='wrap-break-word'>Remove {name}?</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className='pt-2'>
          This permanently deletes:
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody className='grid grid-cols-1 gap-3'>
        <dl
          className='divide-y overflow-hidden rounded-md border'
          data-testid='remove-account-summary'
        >
          {facts.map((fact) => (
            <div key={fact.label} className='flex items-baseline justify-between gap-4 px-3 py-2'>
              <dt className='text-body-small text-muted-foreground'>{fact.label}</dt>
              <dd className='min-w-0 text-right numeric text-body font-medium wrap-break-word'>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className='text-body-small text-muted-foreground'>
          Imports shared with another account stay for that account. This cannot be undone.
        </p>
        {failure && (
          <FailedAlert
            title={failure === 'remove' ? `Couldn't remove ${name}` : `Couldn't hide ${name}`}
          />
        )}
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className='gap-2 md:items-center'>
        <Button
          variant='destructive'
          disabled={isPending || isHiding || !counts}
          onClick={() => void remove()}
          className='md:order-3'
        >
          {isPending ? (
            <PendingLabel>Removing…</PendingLabel>
          ) : (
            <>
              <Trash2 aria-hidden='true' />
              Remove account
            </>
          )}
        </Button>
        <Button variant='outline' type='button' onClick={onClose} className='md:order-2'>
          Cancel
        </Button>
        <Button
          variant='ghost'
          type='button'
          disabled={isPending || isHiding || account.isHidden}
          onClick={() => void hideInstead()}
          className='md:order-1 md:mr-auto'
        >
          {isHiding ? <PendingLabel>Hiding…</PendingLabel> : 'Hide it instead'}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
