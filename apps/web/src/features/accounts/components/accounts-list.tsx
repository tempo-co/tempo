import {useGetAccounts} from '../api/use-get-accounts';
import {AccountCard} from './account-card';
import {AddAccountDialog} from './add-account-dialog';

export function AccountsList() {
  const {accounts, isPending} = useGetAccounts();
  return (
    <>
      {isPending ? (
        <p>Loading...</p>
      ) : (
        <div className='flex flex-col gap-4'>
          {accounts?.map((account) => <AccountCard key={account.id} account={account} />)}
        </div>
      )}
      <AddAccountDialog />
    </>
  );
}
