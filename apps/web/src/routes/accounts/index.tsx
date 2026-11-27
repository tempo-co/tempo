import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {FileUp} from 'lucide-react';
import {useEffect} from 'react';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadingBar} from '@/components/shared/loading-bar';
import {Button} from '@/components/ui/button';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {AccountsOverview} from '@/features/accounts/components/accounts-overview';
import {useAddData} from '@/features/add-data/use-add-data';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {ConnectBankButton} from '@/features/banking/components/connect-bank-steps';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {AccountBalanceAction} from '@/features/file-import/components/account-balance';
import {ImportsList} from '@/features/file-import/components/imports-list';
import {ImportFileButton} from '@/features/file-import/components/page-file-drop';
import {balanceActionOf} from '@/features/file-import/utils/balance-copy';
import {ReportingCurrencySetup} from '@/features/reporting-currency/components/reporting-currency-setup';
import {useNow} from '@/hooks/use-now';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {pageHead} from '@/utils/page-title';
import {savedDataStatus} from '@/utils/query-status';

const bankConnectionResultSchema = z.enum(['connected', 'cancelled', 'error']);

const searchSchema = z.object({
  result: bankConnectionResultSchema.optional(),
  /** The Imports tab; the Accounts tab has no key. */
  tab: z.enum(['imports']).optional().catch(undefined),
});

export const Route = createFileRoute('/accounts/')({
  head: pageHead('Accounts'),
  component: AccountsIndex,
  validateSearch: zodValidator(searchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

/** Every account, grouped by type, with how current each is; and, while file import is on, every import. */
function AccountsIndex() {
  const navigate = useNavigate();
  const {result, tab} = Route.useSearch();
  const {bankConnections, ...query} = useGetAllBankConnections();
  const {isPending, isError} = savedDataStatus({...query, data: bankConnections});
  // The import list answers 404 while file import is off; until it answers, the page shows nothing of it.
  const imports = useBankImports();
  const importOn = imports.state === 'on';
  const addData = useAddData();
  const now = useNow();
  const {connectReturned} = addData;

  // The bank sends the owner back here: the result shows once, and the address loses it.
  useEffect(() => {
    if (!result) return;

    connectReturned(result);
    void navigate({
      to: '/accounts',
      search: (prev) => ({...prev, result: undefined}),
      replace: true,
    });
  }, [connectReturned, navigate, result]);

  const overview = (
    <AccountsOverview
      connections={bankConnections || []}
      isPending={isPending}
      isError={isError}
      error={query.error}
      onRetry={() => query.refetch()}
      imports={imports.data}
      onImport={importOn ? addData.openImport : undefined}
      balanceAction={
        importOn
          ? (account) => {
              const action = balanceActionOf(account);
              return action && <AccountBalanceAction account={account} action={action} />;
            }
          : undefined
      }
      // With import off, the header's Connect a bank is the page's only way in.
      emptyActions={
        importOn && (
          <>
            <ConnectBankButton onClick={addData.openConnect} isStarting={addData.isStarting} />
            <Button variant='outline' onClick={addData.openImport}>
              <FileUp />
              Import a file
            </Button>
          </>
        )
      }
      now={now}
    />
  );

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppBodyLayout>
        <div className='relative grid grid-cols-1 gap-5 max-md:gap-4' data-testid='accounts-page'>
          {/* The padding keeps the content 16px below the overhanging buttons; the 21px row gap leaves 12px between
              the title and buttons wrapped under it. */}
          <header className='flex flex-wrap items-center justify-between gap-x-4 gap-y-5.25 max-md:pb-2.25 md:pointer-coarse:pb-1.25'>
            <h1 className='text-page-title'>Accounts</h1>
            {/* Always there: loading, retrying or failing to load the list never closes an open sheet. They
                overhang the title's 26px row (44px tall on phones and touch screens, 32px otherwise), so the title
                and the content start where other pages' do. On phones the two share the row, equal width. */}
            <div
              className={
                importOn
                  ? '-my-2.25 flex gap-2 max-md:grid max-md:w-full max-md:grid-cols-2 md:-my-1 md:pointer-coarse:-my-2.25'
                  : '-my-2.25 md:-my-1 md:pointer-coarse:-my-2.25'
              }
            >
              {importOn && <ImportFileButton onClick={addData.openImport} />}
              <ConnectBankButton onClick={addData.openConnect} isStarting={addData.isStarting} />
            </div>
          </header>
          <ReportingCurrencySetup />
          {importOn ? (
            <Tabs
              value={tab ?? 'accounts'}
              onValueChange={(value) =>
                void navigate({
                  to: '/accounts',
                  search: (prev) => ({...prev, tab: value === 'imports' ? 'imports' : undefined}),
                  replace: true,
                })
              }
            >
              <TabsList className='max-sm:grid max-sm:w-full max-sm:grid-cols-2'>
                <TabsTrigger value='accounts'>Accounts</TabsTrigger>
                <TabsTrigger value='imports'>Imports</TabsTrigger>
              </TabsList>
              <TabsContent value='accounts'>{overview}</TabsContent>
              <TabsContent value='imports'>
                <ImportsList
                  query={imports}
                  title='Import history'
                  onOpen={(summary, event) => addData.showImport({kind: 'summary', summary}, event)}
                  onReview={(summary, event) =>
                    addData.showImport(
                      {kind: 'review', summary, count: summary.rowsDoubtful},
                      event,
                    )
                  }
                />
                {imports.data?.length === 0 && (
                  <p className='text-body-small text-muted-foreground'>No imports yet</p>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            overview
          )}
        </div>
      </AppBodyLayout>
    </>
  );
}
