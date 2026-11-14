import {CreditCard, Files, Landmark, PiggyBank, Wallet} from 'lucide-react';

import {cn} from '@/utils/cn';

/** The 36px round Clay tile that starts an account row, as it starts a transaction row. */
export const ACCOUNT_TILE =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink';

/** The glyph of an account's type (ISO 20022 cash account type): savings, card, current, or any other. */
export function AccountTypeIcon({type, className}: {type: string | null; className?: string}) {
  const props = {className: cn('size-4', className), strokeWidth: 1.8} as const;
  const normalized = type?.toUpperCase();
  if (normalized === 'SVGS') return <PiggyBank {...props} />;
  if (normalized === 'CARD') return <CreditCard {...props} />;
  if (normalized === 'CACC') return <Wallet {...props} />;
  return <Landmark {...props} />;
}

/** Imported files in place of a bank logo: the files glyph in the Clay tile, square like the logo's plate. */
export function ImportedFilesTile({className, testId}: {className?: string; testId?: string}) {
  return (
    <span
      aria-hidden='true'
      data-testid={testId}
      className={cn(ACCOUNT_TILE, 'rounded-md', className)}
    >
      <Files className='size-4' strokeWidth={1.8} />
    </span>
  );
}
