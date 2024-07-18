import {AccountsBreadcrumb} from '@/features/accounts/components/accounts-breadcrumb';

import {BankStatementUploadInput} from './bank-statement-upload-input';

export function BankStatementsList() {
  return (
    <>
      <AccountsBreadcrumb />
      <BankStatementUploadInput />
    </>
  );
}
