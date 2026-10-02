type BankAccountLabelProps = {
  bankName: string;
  currency: string;
  accountName?: string;
};

/** "Bank · Currency", with the account name underneath when it is needed to tell accounts apart. */
export function BankAccountLabel({bankName, currency, accountName}: BankAccountLabelProps) {
  return (
    <div className='min-w-0'>
      <p className='flex min-w-0 items-center gap-1.5'>
        <span className='truncate'>{bankName}</span>
        <span aria-hidden='true' className='text-muted-foreground'>
          ·
        </span>
        <span className='shrink-0 text-muted-foreground'>{currency}</span>
      </p>
      {accountName && <p className='truncate text-xs text-muted-foreground'>{accountName}</p>}
    </div>
  );
}
