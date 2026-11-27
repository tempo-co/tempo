import {cn} from '@/utils/cn';

/** Enable Banking Oy's entry in the EBA payments register: an account information service provider only. */
const REGISTER_ENTRY =
  'https://euclid.eba.europa.eu/register/pir/view/PSD_AISP/FI_FIN_FSA!29884997';

/** Who makes the bank connection, under which regulator, and that Wisp can only read. */
export function BankConnectionLine({className}: {className?: string}) {
  return (
    <p className={cn('text-body-small text-muted-foreground', className)}>
      Bank connection by{' '}
      <a
        href={REGISTER_ENTRY}
        target='_blank'
        rel='noreferrer'
        className='text-foreground underline decoration-muted underline-offset-4 hover:decoration-foreground'
      >
        Enable Banking Oy
      </a>
      , an account information service provider registered with the Finnish Financial Supervisory
      Authority. Wisp can only read your accounts; it can&apos;t move money.
    </p>
  );
}
