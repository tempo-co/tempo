import {Loader} from 'lucide-react';

/** Button content while its action is running: the progress text followed by a spinner. */
export function PendingLabel({children}: {children: React.ReactNode}) {
  return (
    <>
      <span>{children}</span>
      <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
    </>
  );
}
