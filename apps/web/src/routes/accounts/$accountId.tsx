import {createFileRoute} from '@tanstack/react-router';
import {useRef} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadingBar} from '@/components/shared/loading-bar';
import {LoadErrorState} from '@/components/shared/state-message';
import {AccountNotFound, AccountPage} from '@/features/accounts/components/account-page';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {AccountBalanceAction} from '@/features/file-import/components/account-balance';
import {FileImportDialog} from '@/features/file-import/components/file-import-dialog';
import {ImportsList} from '@/features/file-import/components/imports-list';
import {useFileImport} from '@/features/file-import/components/use-file-import';
import {balanceActionOf} from '@/features/file-import/utils/balance-copy';
import {useLocalDate} from '@/hooks/use-local-date';
import {useNow} from '@/hooks/use-now';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {savedDataStatus} from '@/utils/query-status';

export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountRoute,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

/** One account's page, found among the owner's connections. */
function AccountRoute() {
  const {accountId} = Route.useParams();
  const {bankConnections, ...query} = useGetAllBankConnections();
  const {isPending, isError} = savedDataStatus({...query, data: bankConnections});
  const imports = useBankImports();
  const importOn = imports.state === 'on';
  const fileImport = useFileImport();
  const now = useNow();
  const importButton = useRef<HTMLButtonElement>(null);
  const today = useLocalDate();
  const connection = bankConnections?.find((candidate) =>
    candidate.bankAccounts.some(({id}) => id === accountId),
  );
  const account = connection?.bankAccounts.find(({id}) => id === accountId);
  const balance = account && isFileConnection(connection!) ? balanceActionOf(account) : null;

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppBodyLayout>
        {isPending ? null : isError ? (
          <LoadErrorState
            title="Couldn't load this account"
            error={query.error}
            onRetry={() => query.refetch()}
          />
        ) : !account || !connection ? (
          <AccountNotFound />
        ) : (
          <AccountPage
            key={account.id}
            account={account}
            connection={connection}
            imports={imports.data}
            importsList={
              importOn &&
              imports.data?.some((summary) =>
                summary.accounts.some(({id}) => id === account.id),
              ) ? (
                <ImportsList
                  query={imports}
                  accountId={account.id}
                  title='Imports for this account'
                  onOpen={(summary) => fileImport.show({kind: 'summary', summary})}
                  onReview={(summary) =>
                    fileImport.show({kind: 'review', summary, count: summary.rowsDoubtful})
                  }
                />
              ) : undefined
            }
            onImport={importOn ? fileImport.openNew : undefined}
            importButton={importButton}
            balanceAction={
              importOn && balance ? (
                <AccountBalanceAction account={account} action={balance} />
              ) : undefined
            }
            today={today}
            now={now}
          />
        )}
        {importOn && <FileImportDialog controller={fileImport} returnFocus={importButton} />}
      </AppBodyLayout>
    </>
  );
}
