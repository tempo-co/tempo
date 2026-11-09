import type {BankConnectionAspsp} from '@tempo/contracts';
import {useState} from 'react';

import {cn} from '@/utils/cn';

/**
 * A bank's logo as the provider ships it: usually a wide wordmark (symbol plus name), so it gets a wide slot of
 * fixed height instead of a square it would shrink into. The light plate keeps dark marks readable on Night;
 * on Paper it is a faint tint. Without a logo, the bank's initials stand in at the slot's height.
 */
export function BankWordmark({
  bank,
  size = 'md',
  className,
}: {
  bank: Pick<BankConnectionAspsp, 'name' | 'logoUrl'>;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = bank.logoUrl && bank.logoUrl !== failed ? bank.logoUrl : null;
  const box = size === 'lg' ? 'h-14 w-48 px-3 py-2.5' : 'h-9 w-28 px-2 py-1.5';

  // Same plate, in the tile colours, so a bank without a logo keeps the column's shape.
  if (!src)
    return (
      <span
        aria-hidden='true'
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border border-transaction-tile-edge bg-transaction-tile-field font-medium tracking-wide text-transaction-tile-ink',
          box,
          size === 'lg' ? 'text-lg' : 'text-xs',
          className,
        )}
      >
        {initials(bank.name)}
      </span>
    );

  return (
    <span
      aria-hidden='true'
      data-testid='bank-wordmark'
      className={cn(
        'flex shrink-0 items-center justify-start overflow-hidden rounded-md border border-border/60 bg-[#F6F1E8]',
        box,
        className,
      )}
    >
      <img
        src={src}
        alt=''
        loading='lazy'
        referrerPolicy='no-referrer'
        className='h-full w-full object-contain object-left'
        onError={() => setFailed(src)}
      />
    </span>
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('') || name.slice(0, 2)
  ).toUpperCase();
}
