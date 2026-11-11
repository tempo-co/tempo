import {skipToken, useQuery, useQueryClient} from '@tanstack/react-query';
import type {BankConnectionAspsp} from '@tempo/contracts';
import {useEffect, useMemo} from 'react';

import {bankQueryKeys} from './query-keys';
import {bankConnectionsQueryOptions} from './use-get-all-bank-connections';
import {useGetSupportedBanks} from './use-get-supported-banks';

/** Logo URLs by `bankLogoKey`. */
export type BankLogos = Record<string, Pick<BankConnectionAspsp, 'logoUrl' | 'logo'>>;

export function bankLogoKey(name: string, country: string) {
  return `${country.trim().toUpperCase()}:${name.trim().toLowerCase()}`;
}

/**
 * Logos of the connected banks. The provider's bank list is large and is not saved for offline
 * use, so the logos it gives the connected banks are kept as their own small query, which is.
 */
export const useBankLogos = (enabled: boolean) => {
  const queryClient = useQueryClient();
  // Every connection, whichever of them the caller shows, so that each page saves the same logos.
  const {data: connections, dataUpdatedAt} = useQuery({
    ...bankConnectionsQueryOptions,
    enabled: false,
  });
  // Older saved responses can lack references; current connections need no provider-catalogue request.
  const {supportedBanks} = useGetSupportedBanks(
    enabled && !!connections?.some((connection) => !connection.logo),
  );
  const {data: savedLogos} = useQuery<BankLogos>({
    queryKey: bankQueryKeys.connectedBankLogos,
    queryFn: skipToken,
  });

  const logos = useMemo(() => {
    if (!connections) return undefined;
    if (connections.some((connection) => !connection.logo) && !supportedBanks) return undefined;
    const connected = new Set(
      connections.map((connection) => bankLogoKey(connection.aspspName, connection.aspspCountry)),
    );
    const logos: BankLogos = {};
    for (const bank of supportedBanks ?? []) {
      const key = bankLogoKey(bank.name, bank.country);
      if ((bank.logo || bank.logoUrl) && connected.has(key))
        logos[key] = {logo: bank.logo, logoUrl: bank.logoUrl};
    }
    for (const connection of connections) {
      if (connection.logo)
        logos[bankLogoKey(connection.aspspName, connection.aspspCountry)] = {logo: connection.logo};
    }
    return logos;
  }, [supportedBanks, connections]);

  // Written again with each fetch of the bank list, so the saved logos stay within the offline age
  // limit while the app is open.
  useEffect(() => {
    if (logos) queryClient.setQueryData(bankQueryKeys.connectedBankLogos, logos);
  }, [logos, dataUpdatedAt, queryClient]);

  return logos ?? savedLogos ?? {};
};
