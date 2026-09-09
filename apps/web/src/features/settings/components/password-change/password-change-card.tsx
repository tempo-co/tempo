import {KeyRound} from 'lucide-react';

import {PasswordChangeDialog} from './password-change-dialog';

export function PasswordChangeCard() {
  return (
    <section aria-labelledby='password-heading' className='space-y-3'>
      <div className='space-y-1'>
        <h2 id='password-heading' className='text-lg font-semibold'>
          Password
        </h2>
        <p className='text-sm text-muted-foreground'>Update the password you use to sign in.</p>
      </div>
      <div className='flex flex-row items-center justify-between gap-4 rounded-card border bg-card p-4 sm:p-5'>
        <div className='flex min-w-0 flex-grow items-center gap-4'>
          <div className='flex-shrink-0 rounded-lg bg-accent p-2 text-muted-foreground'>
            <KeyRound className='h-4 w-4 sm:h-6 sm:w-6' />
          </div>
          <div className='min-w-0 flex-grow'>
            <p className='truncate text-sm font-medium'>Password</p>
            <p className='mt-1 text-xs text-muted-foreground'>Keep it unique and hard to guess.</p>
          </div>
        </div>
        <div className='flex-shrink-0'>
          <PasswordChangeDialog />
        </div>
      </div>
    </section>
  );
}
