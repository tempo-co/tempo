import {createFileRoute} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadingBar} from '@/components/shared/loading-bar';
import {LoadErrorState} from '@/components/shared/state-message';
import {AccountNotFound, AccountPage} from '@/features/accounts/components/account-page';
import {useAddData} from '@/features/add-data/use-add-data';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {AccountBalanceAction} from '@/features/file-import/components/account-balance';
import {ImportsList} from '@/features/file-import/components/imports-list';
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
  const addData = useAddData();
  const now = useNow();
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
                  onOpen={(summary, event) => addData.showImport({kind: 'summary', summary}, event)}
                  onReview={(summary, event) =>
                    addData.showImport(
                      {kind: 'review', summary, count: summary.rowsDoubtful},
                      event,
                    )
                  }
                />
              ) : undefined
            }
            onImport={importOn ? addData.openImport : undefined}
            balanceAction={
              importOn && balance ? (
                <AccountBalanceAction account={account} action={balance} />
              ) : undefined
            }
            today={today}
            now={now}
          />
        )}
      </AppBodyLayout>
    </>
  );
}
