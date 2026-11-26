import type {BankConnection, BankConnectionAspsp} from '@tempo/contracts';
import {toast} from 'sonner';

import {useStartBankConnection} from '@/features/banking/api/use-start-bank-connection';
import {wasToasted} from '@/utils/api';

type Bank = Pick<BankConnectionAspsp, 'name' | 'country'>;

/** The bank this tab last left for, so its return can offer to try it again. */
const CONNECTING_KEY = 'wisp-connecting-bank';

/** The bank this tab left for, once: read on its return, then forgotten. Null when the tab does not remember one. */
export function takeConnectingBank(): Bank | null {
  try {
    const saved = sessionStorage.getItem(CONNECTING_KEY);
    sessionStorage.removeItem(CONNECTING_KEY);
    const bank: unknown = saved && JSON.parse(saved);
    return bank &&
      typeof bank === 'object' &&
      'name' in bank &&
      'country' in bank &&
      typeof bank.name === 'string' &&
      typeof bank.country === 'string'
      ? {name: bank.name, country: bank.country}
      : null;
  } catch {
    return null;
  }
}

/**
 * Hands off to a bank's own site to connect it, or to reconnect a connection whose access has ended or never
 * finished: the bank returns to Accounts with the result.
 */
export function useConnectBank() {
  const {startBankConnection, isPending} = useStartBankConnection();

  const connect = async (bank: Bank) => {
    try {
      const {authorizationUrl} = await startBankConnection({
        aspspName: bank.name,
        aspspCountry: bank.country,
      });
      try {
        sessionStorage.setItem(
          CONNECTING_KEY,
          JSON.stringify({name: bank.name, country: bank.country}),
        );
      } catch {
        // Without storage the return still says what happened, only not at which bank.
      }
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (wasToasted(error)) return;
      toast.error('Unable to add bank connection', {
        description: 'Try again in a moment.',
        id: 'bank-connection-start-failed',
      });
    }
  };

  const reconnect = (connection: BankConnection) =>
    connect({name: connection.aspspName, country: connection.aspspCountry});

  return {connect, reconnect, isStarting: isPending};
}
