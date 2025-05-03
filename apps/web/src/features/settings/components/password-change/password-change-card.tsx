import {KeyRound} from 'lucide-react';

import {PasswordChangeDialog} from './password-change-dialog';

export function PasswordChangeCard() {
  return (
    <div>
      <div className='mb-4'>
        <h2 className='mb-1 text-lg font-medium'>Password</h2>
      </div>
      <div className='flex flex-row items-center justify-between gap-4 rounded-lg border bg-card p-4'>
        <div className='flex min-w-0 flex-grow items-center gap-4'>
          <div className='flex-shrink-0 rounded-lg bg-accent p-2 text-muted-foreground'>
            <KeyRound className='h-4 w-4 sm:h-6 sm:w-6' />
          </div>
          <div className='min-w-0 flex-grow'>
            <p className='truncate text-sm font-medium'>Password</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Strengthen your account by ensuring your password is strong.
            </p>
          </div>
        </div>
        <div className='flex-shrink-0'>
          <PasswordChangeDialog />
        </div>
      </div>
    </div>
  );
}
