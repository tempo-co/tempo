import {TextBone} from '@/features/dashboard/components/loading';
import {SettingsRow} from '@/features/settings/components/settings-group';

import {useReportingCurrency} from '../api/use-reporting-currency';
import {ReportingCurrencyDialog} from './reporting-currency-dialog';

/** The Settings row for the currency totals use. */
export function ReportingCurrencyRow() {
  const {data: settings, isError} = useReportingCurrency();
  return (
    <SettingsRow
      label='Reporting currency'
      value={
        settings ? (
          <span data-testid='account-reporting-currency'>
            {settings.currency ?? 'Not chosen yet'}
            {settings.recalculating && ' · Recalculating totals…'}
          </span>
        ) : isError ? (
          "Couldn't load"
        ) : (
          <TextBone className='w-[8em]' />
        )
      }
      action={settings && <ReportingCurrencyDialog settings={settings} />}
    />
  );
}
