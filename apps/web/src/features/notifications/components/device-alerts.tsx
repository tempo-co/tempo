import {useEffect} from 'react';

import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {useCurrentAccount} from '@/hooks/use-current-account';

import {registerExistingSubscription} from '../api/use-notifications';
import {setAppBadge} from '../utils/push-device';

/**
 * While Tempo is open and signed in, its app icon counts the transactions that need review, the Transactions tab's
 * count; signing out clears it, also when a review count read during sign-out arrives late. A
 * browser already subscribed to alerts is registered with this session once Tempo has confirmed the session, so
 * opening a saved Tempo offline tries no write.
 */
export function DeviceAlerts() {
  const needsAttention = useGetBankTransactionReviewCounts().reviewCounts?.needsAttention;
  const {currentAccount, isConfirmed} = useCurrentAccount({skipFetch: true});
  const confirmedAccountId = isConfirmed ? currentAccount?.id : undefined;

  useEffect(() => {
    if (needsAttention !== undefined) setAppBadge(needsAttention);
  }, [needsAttention]);
  // Mounted only in the signed-in layout.
  useEffect(() => () => setAppBadge(0), []);

  useEffect(() => {
    if (!confirmedAccountId) return;
    void registerExistingSubscription().catch(() => {
      /* Alerts resume the next time Tempo opens. */
    });
  }, [confirmedAccountId]);

  return null;
}
