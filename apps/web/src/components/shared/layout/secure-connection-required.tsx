import Logo from '@/assets/logo';

/** Shown instead of the app where the browser withholds APIs it needs, such as on plain HTTP. */
export function SecureConnectionRequired() {
  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center'>
      <Logo className='h-12 w-12 text-primary' />
      <h1 className='text-xl font-semibold'>Tempo needs a secure connection</h1>
      <p className='max-w-sm text-sm text-muted-foreground'>
        This browser cannot coordinate sign-out between tabs here. Open Tempo over HTTPS.
      </p>
    </div>
  );
}
