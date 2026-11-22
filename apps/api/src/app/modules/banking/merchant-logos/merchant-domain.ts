import {parse} from 'tldts';

import {isHostname} from '../banking.utils';

const MAX_DOMAIN_LENGTH = 64;
const MAX_SUBDOMAIN_LENGTH = 8;

/**
 * The website hostname the model named for a merchant, when it is one a logo may be looked up for: a registrable domain
 * (public-suffix aware, such as example.co.uk) or one short label below it, such as shop.example.com. A longer or deeper
 * hostname could carry the owner's other merchant names to a name server through its DNS lookup, so it is null.
 */
export function toMerchantDomain(domain: string | null): string | null {
	if (!domain || domain.length > MAX_DOMAIN_LENGTH || !isHostname(domain)) return null;
	const {domain: registrable, subdomain} = parse(domain, {allowPrivateDomains: true});
	if (!registrable) return null;
	if (!subdomain) return domain;
	return !subdomain.includes('.') && subdomain !== 'www' && subdomain.length <= MAX_SUBDOMAIN_LENGTH ? domain : null;
}
