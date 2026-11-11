import type {BankLogoReference} from '@tempo/contracts';

export function bankLogoReference(name: string, country: string): BankLogoReference {
	return {
		metadataUrl: `/bank-connections/aspsps/logos/${encodeURIComponent(country)}/${Buffer.from(name).toString('base64url')}`,
	};
}
