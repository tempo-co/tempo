import type {BankConnection, BankConnectionAspsp} from '@tempo/contracts';
import {toast} from 'sonner';

import {useStartBankConnection} from '@/features/banking/api/use-start-bank-connection';
import {wasToasted} from '@/utils/api';

/**
 * Hands off to a bank's own site to connect it, or to reconnect a connection whose access has ended or never
 * finished: the bank returns to Accounts with the result.
 */
export function useConnectBank() {
  const {startBankConnection, isPending} = useStartBankConnection();

  const connect = async (bank: Pick<BankConnectionAspsp, 'name' | 'country'>) => {
    try {
      const {authorizationUrl} = await startBankConnection({
        aspspName: bank.name,
        aspspCountry: bank.country,
      });
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
