import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {CASH_FLOW_INTERVALS, MERCHANT_SEARCH_MAX_LENGTH} from '@tempo/contracts';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {MerchantsOverview} from '@/features/merchants/components/merchants-overview';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const merchantsSearchSchema = z.object({
  q: z.string().max(MERCHANT_SEARCH_MAX_LENGTH).optional().catch(undefined),
  interval: z.enum(CASH_FLOW_INTERVALS).optional().catch(undefined),
  /** Any day in the ranked period, so Home's past month opens on that month. */
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/merchants/')({
  component: MerchantsIndex,
  validateSearch: zodValidator(merchantsSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function MerchantsIndex() {
  const {q, interval, period} = Route.useSearch();
  return (
    <AppBodyLayout>
      <MerchantsOverview search={q?.trim() ?? ''} interval={interval ?? 'month'} period={period} />
    </AppBodyLayout>
  );
}
