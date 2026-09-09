import {Button} from '@/components/ui/button';

import {AccountDeleteDialog} from './account-delete-dialog';

export function AccountDelete() {
  return (
    <section aria-labelledby='danger-zone-heading' className='space-y-3 pt-2'>
      <div className='space-y-1'>
        <h2 id='danger-zone-heading' className='text-lg font-semibold'>
          Danger zone
        </h2>
      </div>
      <div className='flex flex-col items-start justify-between gap-4 rounded-card border border-destructive/50 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:p-5'>
        <div className='min-w-0'>
          <p className='mb-1 text-sm font-medium'>Permanently delete your account</p>
          <p className='max-w-[34rem] text-xs text-muted-foreground'>
            Deleting your account cannot be undone. Please be certain.
          </p>
        </div>
        <AccountDeleteDialog>
          <Button
            variant='destructive'
            className='min-h-11 w-full shrink-0 text-foreground sm:w-fit'
            data-testid='delete-account-button'
          >
            Delete account
          </Button>
        </AccountDeleteDialog>
      </div>
    </section>
  );
}
