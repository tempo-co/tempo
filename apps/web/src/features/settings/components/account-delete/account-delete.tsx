import {Button} from '@/components/ui/button';

export function AccountDelete() {
  return (
    <div className='mt-8'>
      <div className='mb-4'>
        <h2 className='mb-1 text-lg font-medium'>Danger zone</h2>
      </div>
      <div className='flex flex-col items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive-foreground/20 p-4 sm:flex-row sm:items-center'>
        <div>
          <p className='mb-1 text-sm font-medium'>Permanently delete your account</p>
          <p className='mr-8 text-xs text-muted-foreground'>
            Deleting your account cannot be undone. Please be certain.
          </p>
        </div>
        <Button variant='destructive' className='w-full shrink-0 text-foreground sm:w-fit'>
          Delete account
        </Button>
      </div>
    </div>
  );
}
