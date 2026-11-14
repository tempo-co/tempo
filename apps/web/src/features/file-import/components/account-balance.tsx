import type {BankAccount, BankImportSummary} from '@tempo/contracts';
import {Check} from 'lucide-react';
import {useId, useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
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
import {wasToasted} from '@/utils/api';
import {formatCurrency} from '@/utils/format-currency';

import {useSetAccountBalance} from '../api/use-set-account-balance';
import {
  ADD_BALANCE,
  BALANCE_HELP,
  type BalanceAction,
  INVALID_BALANCE,
  balanceLabel,
  describeBalanceFailure,
  parseBalanceAmount,
} from '../utils/balance-copy';
import {importAccountName, useKnownAccounts} from './use-known-accounts';

type AccountWithoutBalance = BankImportSummary['accountsWithoutBalance'][number];

/**
 * An amount field with its currency inside, at the far right, and Save for one account's balance today: invalid
 * input is told under the field, a failed save in a toast. Answers the saved account. In the summary Save sits
 * beside the field; in a dialog, Save and Cancel sit in its footer under it.
 */
function BalanceForm({
  accountId,
  label,
  currency,
  initial = '',
  autoFocus,
  onCancel,
  optional,
  onSaved,
}: {
  accountId: string;
  label: string;
  currency: string;
  initial?: string;
  autoFocus?: boolean;
  /** The dialog's Cancel: given, the form fills the dialog's body and footer. */
  onCancel?: () => void;
  /** Asked beside the summary's own actions: Save is outlined, so Done stays the main one. */
  optional?: boolean;
  onSaved: (account: BankAccount) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const {setAccountBalance, isPending} = useSetAccountBalance();

  const save = async () => {
    const amount = parseBalanceAmount(value);
    setInvalid(amount === null);
    if (amount === null || isPending) return;
    try {
      onSaved(await setAccountBalance({accountId, amount}));
    } catch (error) {
      if (wasToasted(error)) return;
      const {title, description} = describeBalanceFailure(error);
      toast.error(title, {description, id: `account-balance-failed-${accountId}`});
    }
  };

  const saveButton = (
    <Button
      type='submit'
      variant={optional ? 'outline' : 'default'}
      disabled={isPending}
      className={onCancel ? 'md:order-2' : undefined}
    >
      {isPending ? <PendingLabel>Saving…</PendingLabel> : 'Save'}
    </Button>
  );
  // The currency sits over the field's right padding, so a long amount scrolls under neither it nor the edge.
  const amountField = (
    <div className='relative min-w-0 flex-1 basis-40'>
      <Input
        id={`${id}-amount`}
        inputMode='decimal'
        autoComplete='off'
        autoFocus={autoFocus}
        placeholder='0.00'
        value={value}
        disabled={isPending}
        aria-invalid={invalid || undefined}
        aria-describedby={
          invalid ? `${id}-currency ${id}-help ${id}-error` : `${id}-currency ${id}-help`
        }
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        className='peer pr-14 numeric max-sm:h-12'
      />
      <span
        id={`${id}-currency`}
        className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground peer-disabled:opacity-50'
      >
        {currency}
      </span>
    </div>
  );
  const fields = (
    <div className='grid grid-cols-1 gap-2'>
      <div className='grid grid-cols-1 gap-0.5'>
        <label htmlFor={`${id}-amount`} className='text-sm font-medium wrap-anywhere'>
          {label}
        </label>
        <p id={`${id}-help`} className='text-xs text-muted-foreground'>
          {BALANCE_HELP}
        </p>
      </div>
      {onCancel ? (
        amountField
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          {amountField}
          <div className='flex max-sm:w-full max-sm:[&>*]:flex-1'>{saveButton}</div>
        </div>
      )}
      {invalid && (
        <p id={`${id}-error`} role='alert' className='text-xs text-destructive'>
          {INVALID_BALANCE.title}. {INVALID_BALANCE.description}
        </p>
      )}
    </div>
  );

  return (
    <form
      noValidate
      className={onCancel ? 'grid grid-cols-1 gap-4' : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {onCancel ? (
        <>
          <ResponsiveDialogBody>{fields}</ResponsiveDialogBody>
          <ResponsiveDialogFooter className='gap-2'>
            {saveButton}
            <Button type='button' variant='outline' className='md:order-1' onClick={onCancel}>
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </>
      ) : (
        fields
      )}
    </form>
  );
}

/**
 * The import summary's question for each imported-files account it wrote to that has no balance. Optional: the
 * summary closes without it. A saved balance stays shown as saved, though the account then leaves the list.
 */
export function ImportBalancePrompts({summary}: {summary: BankImportSummary}) {
  const known = useKnownAccounts();
  const [saved, setSaved] = useState<
    Array<{account: AccountWithoutBalance; balance: BankAccount['currentBalanceAmount']}>
  >([]);
  const asking = summary.undoneAt ? [] : summary.accountsWithoutBalance;
  // In the order the summary lists its accounts, so a saved row stays where it was.
  const order = summary.accounts.map(({id}) => id);
  const rows = [
    ...asking.filter(({id}) => !saved.some((entry) => entry.account.id === id)),
    ...saved.map(({account}) => account),
  ]
    .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
    .map((account) => ({
      account,
      balance: saved.find((entry) => entry.account.id === account.id)?.balance ?? null,
    }));
  if (rows.length === 0) return null;

  return (
    <section
      aria-label='Balances'
      className='grid grid-cols-1 gap-3'
      data-testid='bank-import-balances'
    >
      {rows.map(({account, balance}) => {
        const name = importAccountName(account, known);
        return balance === null ? (
          <BalanceForm
            key={account.id}
            accountId={account.id}
            label={balanceLabel(name)}
            currency={account.currency}
            optional
            onSaved={(updated) =>
              setSaved((current) => [
                ...current.filter((entry) => entry.account.id !== account.id),
                {account, balance: updated.currentBalanceAmount},
              ])
            }
          />
        ) : (
          <div key={account.id} className='grid grid-cols-1 gap-1'>
            <p className='text-sm font-medium wrap-anywhere'>{balanceLabel(name)}</p>
            <p role='status' className='flex items-center gap-2 text-sm'>
              <span className='numeric'>{formatCurrency(Number(balance), account.currency)}</span>
              <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                <Check aria-hidden='true' className='size-3.5' />
                Saved
              </span>
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** A stored balance (scale 8) as the field shows it: two decimals, cut rather than rounded through a float. */
function toTwoDecimals(amount: string) {
  const [whole, fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/**
 * The balance action of an imported-files account on its card (`balanceActionOf`): Add balance or Edit. The form
 * opens in a dialog.
 */
export function AccountBalanceAction({
  account,
  action,
}: {
  account: BankAccount;
  action: Exclude<BalanceAction, null>;
}) {
  const [open, setOpen] = useState(false);
  const source = action === 'edit' ? 'stated' : null;
  const name = accountName(account);

  return (
    <>
      <TextAction
        onClick={() => setOpen(true)}
        aria-label={source ? `Edit balance of ${name}` : `${ADD_BALANCE} of ${name}`}
        className={source ? '-mr-2 h-auto py-0 text-xs text-muted-foreground' : '-mr-2'}
      >
        {source ? 'Edit' : ADD_BALANCE}
      </TextAction>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className='md:w-120'>
          <ResponsiveDialogHeader className='text-start'>
            <ResponsiveDialogTitle>{source ? 'Edit balance' : ADD_BALANCE}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className='sr-only'>
              {balanceLabel(name)}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {open && (
            <BalanceForm
              accountId={account.id}
              label={balanceLabel(name)}
              currency={account.currency}
              initial={source ? toTwoDecimals(account.currentBalanceAmount!) : ''}
              autoFocus
              onCancel={() => setOpen(false)}
              onSaved={() => setOpen(false)}
            />
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
