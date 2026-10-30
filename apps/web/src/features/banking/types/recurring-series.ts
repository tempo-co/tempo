import type {RecurringCadence} from '@tempo/contracts';

export const RECURRING_CADENCE_LABELS: Record<RecurringCadence, string> = {
  WEEKLY: 'Weekly',
  FOUR_WEEKLY: 'Every 4 weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};
