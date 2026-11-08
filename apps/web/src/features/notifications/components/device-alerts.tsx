import {useEffect} from 'react';

import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';

import {registerExistingSubscription} from '../api/use-notifications';
import {setAppBadge} from '../utils/push-device';

/**
 * While Tempo is open, its app icon counts the transactions that need review, the Transactions tab's count. A
 * browser already subscribed to alerts is registered with this session once.
 */
export function DeviceAlerts() {
  const needsAttention = useGetBankTransactionReviewCounts().reviewCounts?.needsAttention;

  useEffect(() => {
    if (needsAttention !== undefined) setAppBadge(needsAttention);
  }, [needsAttention]);

  useEffect(() => {
    void registerExistingSubscription().catch(() => {
      /* Alerts resume the next time Tempo opens. */
    });
  }, []);

  return null;
}
