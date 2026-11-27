import {createFileRoute} from '@tanstack/react-router';

import {BankConnectionLine} from '@/components/shared/bank-connection-line';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {pageHead} from '@/utils/page-title';

const ADDRESSES = [
  {label: 'Website', name: 'wispmoney.com', href: 'https://wispmoney.com'},
  {label: 'App', name: 'app.wispmoney.com', href: 'https://app.wispmoney.com'},
  {
    label: 'Emails come from',
    name: 'no-reply@wispmoney.com',
    href: 'mailto:no-reply@wispmoney.com',
  },
  {label: 'Support', name: 'support@wispmoney.com', href: 'mailto:support@wispmoney.com'},
  {
    label: 'Source code',
    name: 'github.com/wispmoney/wisp',
    href: 'https://github.com/wispmoney/wisp',
  },
];

/** Wisp's own addresses, open signed in or out, so a link or an email can be checked before logging in. */
export const Route = createFileRoute('/official')({
  component: Official,
  head: pageHead('Official addresses'),
});

function Official() {
  return (
    <AuthLayout title='Official addresses'>
      <div className='space-y-4'>
        <dl className='divide-y rounded-md border'>
          {ADDRESSES.map(({label, name, href}) => (
            <div key={href} className='flex flex-col gap-0.5 px-3 py-2.5'>
              <dt className='text-label text-muted-foreground'>{label}</dt>
              <dd className='min-w-0 text-body wrap-break-word'>
                <a
                  href={href}
                  className='underline decoration-muted underline-offset-4 hover:decoration-foreground'
                >
                  {name}
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <p className='text-body font-medium'>
          We never ask for your bank password; you log in to your bank only on your bank&apos;s own
          site.
        </p>
        <BankConnectionLine />
      </div>
    </AuthLayout>
  );
}
