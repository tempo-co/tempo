import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useEffect, useRef} from 'react';
import {toast} from 'sonner';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {BankConnectionList} from '@/features/banking/components/bank-connection-list';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {AccountBalanceAction} from '@/features/file-import/components/account-balance';
import {FileImportDialog} from '@/features/file-import/components/file-import-dialog';
import {ImportsList} from '@/features/file-import/components/imports-list';
import {ImportFileButton, PageFileDrop} from '@/features/file-import/components/page-file-drop';
import {BUSY, useFileImport} from '@/features/file-import/components/use-file-import';
import {balanceActionOf} from '@/features/file-import/utils/balance-copy';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {savedDataStatus} from '@/utils/query-status';

const bankConnectionResultSchema = z.enum(['connected', 'cancelled', 'error']);

const searchSchema = z.object({
  result: bankConnectionResultSchema.optional(),
});

type BankConnectionResult = z.infer<typeof bankConnectionResultSchema>;

export const Route = createFileRoute('/bank-connections/')({
  component: BankConnectionsIndex,
  validateSearch: zodValidator(searchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function showBankConnectionResult(result: BankConnectionResult) {
  if (result === 'connected') {
    toast.success('Bank connection added', {id: 'bank-connection-success'});
  } else if (result === 'cancelled') {
    toast.info('Bank connection cancelled', {id: 'bank-connection-cancelled'});
  } else {
    toast.error('Bank connection failed', {
      description: 'No bank account data was changed. Please try again.',
      id: 'bank-connection-error',
    });
  }
}

function BankConnectionsIndex() {
  const navigate = useNavigate();
  const {result} = Route.useSearch();
  const {bankConnections, ...query} = useGetAllBankConnections();
  const {isPending, isError} = savedDataStatus({...query, data: bankConnections});
  // The import list answers 404 while file import is off; until it answers, the page shows nothing of it.
  const imports = useBankImports();
  const fileImport = useFileImport();
  const importButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!result) return;

    showBankConnectionResult(result);
    void navigate({to: '/bank-connections', search: {}});
  }, [navigate, result]);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppBodyLayout>
        <BankConnectionList
          bankConnections={bankConnections || []}
          isPending={isPending}
          isError={isError}
          error={query.error}
          onRetry={() => query.refetch()}
          fileImport={
            imports.state === 'on'
              ? {
                  action: <ImportFileButton ref={importButton} onClick={fileImport.openNew} />,
                  onImport: fileImport.openNew,
                  // One import at a time: a drop waits until the running one has answered.
                  drop: (
                    <PageFileDrop
                      enabled={!fileImport.open && !BUSY.includes(fileImport.step.kind)}
                      onFiles={fileImport.importDropped}
                    />
                  ),
                  imports: (
                    <ImportsList
                      query={imports}
                      onOpen={(summary) => fileImport.show({kind: 'summary', summary})}
                    />
                  ),
                  balanceAction: (account) => {
                    const action = balanceActionOf(account);
                    return action && <AccountBalanceAction account={account} action={action} />;
                  },
                }
              : undefined
          }
        />
        {imports.state === 'on' && (
          <FileImportDialog controller={fileImport} returnFocus={importButton} />
        )}
      </AppBodyLayout>
    </>
  );
}
