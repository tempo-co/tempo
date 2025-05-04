import {Link} from '@tanstack/react-router';

import {Badge} from '@/components/ui/badge';

export function NotFound() {
  return (
    <div className='flex min-h-screen flex-col items-center justify-center space-y-6 bg-background text-center'>
      <Badge className='font-mono text-base' variant='secondary'>
        404
      </Badge>
      <h1 className='text-3xl font-semibold text-foreground'>Page Not Found</h1>
      <p className='text-muted-foreground'>
        Sorry, we can&apos;t find the page you&apos;re looking for.
      </p>
      <Link
        to='/'
        className='inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
      >
        Back to Home
      </Link>
    </div>
  );
}
