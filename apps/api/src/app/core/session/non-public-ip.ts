import {BlockList, isIPv6} from 'net';

export const PRIVATE_NETWORK = 'Private network';

/** Address ranges that never map to a physical location (private, carrier-grade NAT, link-local, unspecified). */
const NON_PUBLIC_RANGES = new BlockList();
NON_PUBLIC_RANGES.addSubnet('0.0.0.0', 8);
NON_PUBLIC_RANGES.addSubnet('10.0.0.0', 8);
NON_PUBLIC_RANGES.addSubnet('100.64.0.0', 10);
NON_PUBLIC_RANGES.addSubnet('169.254.0.0', 16);
NON_PUBLIC_RANGES.addSubnet('172.16.0.0', 12);
NON_PUBLIC_RANGES.addSubnet('192.168.0.0', 16);
NON_PUBLIC_RANGES.addAddress('::', 'ipv6');
NON_PUBLIC_RANGES.addSubnet('fc00::', 7, 'ipv6');
NON_PUBLIC_RANGES.addSubnet('fe80::', 10, 'ipv6');

/** Whether an IP address belongs to a range that geolocation databases cannot place. */
export function isNonPublicIp(ip: string) {
	return NON_PUBLIC_RANGES.check(ip, isIPv6(ip) ? 'ipv6' : 'ipv4');
}
