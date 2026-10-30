import {Injectable, Logger} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

import {safeErrorName} from '../banking.utils';
import {SVG_RENDER_SIZE} from './merchant-svg';

const API_URL = 'https://api.logo.dev/v2/brands/logo';
const TIMEOUT_MS = 8000;
/** The size the logo is downloaded at; the stored logo is smaller, so this is only an upper bound. */
const DOWNLOAD_SIZE = '256';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Free credits renew monthly; out of them, logo.dev is asked again a week later rather than daily. */
const OUT_OF_CREDITS_RETRY_MS = 7 * DAY_MS;

/**
 * What logo.dev knows about a domain. `size` is the shorter side of the original it holds, with a vector counted as
 * its render size: the download is always enlarged to the requested size, so only the original says how sharp it is.
 * `later` means it is still indexing the domain, out of the month's free credits or unreachable, and says when to ask
 * again; nothing was charged.
 */
export type LogoDevResult =
	{status: 'found'; url: string; size: number} | {status: 'none'} | {status: 'later'; retryAfterMs: number};

/**
 * logo.dev's logo API, asked with the merchant's domain only. Used only when a secret key is configured; its download
 * URL is fetched through the merchant site fetcher like any other icon.
 */
@Injectable()
export class LogoDevClient {
	private readonly logger = new Logger(LogoDevClient.name);

	constructor(private readonly configurationService: ConfigurationService) {}

	async findLogo(domain: string): Promise<LogoDevResult> {
		const key = this.configurationService.get('LOGO_DEV_SECRET_KEY');
		if (!key) return {status: 'none'};
		try {
			const response = await fetch(`${API_URL}?domain=${encodeURIComponent(domain)}`, {
				headers: {Authorization: `Bearer ${key}`, Accept: 'application/json'},
				redirect: 'error',
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (response.status === 401 || response.status === 403)
				this.logger.warn(`logo.dev refused the secret key: HTTP ${response.status}`);
			if (response.status !== 200) {
				await response.body?.cancel();
				return toLogoDevResult(response.status, null);
			}
			return toLogoDevResult(200, await response.json());
		} catch (error) {
			this.logger.warn(`logo.dev lookup failed: ${safeErrorName(error)}`);
			return {status: 'later', retryAfterMs: DAY_MS};
		}
	}
}

type LogoResponse = {
	data?: {url?: unknown; source?: {width?: unknown; height?: unknown; is_vector?: unknown}};
};

/** Reads the API's answer: a logo with its original's size, none for this domain, or try again later. */
export function toLogoDevResult(status: number, body: unknown): LogoDevResult {
	if (status === 404) return {status: 'none'};
	if (status === 402) return {status: 'later', retryAfterMs: OUT_OF_CREDITS_RETRY_MS};
	if (status !== 200) return {status: 'later', retryAfterMs: DAY_MS};
	const {url, source} = (body as LogoResponse | null)?.data ?? {};
	if (typeof url !== 'string' || !source) return {status: 'none'};
	const {width, height, is_vector: vector} = source;
	const size = vector === true ? SVG_RENDER_SIZE : Math.min(Number(width) || 0, Number(height) || 0);
	let download: URL;
	try {
		download = new URL(url);
	} catch {
		return {status: 'none'};
	}
	download.searchParams.set('format', 'png');
	download.searchParams.set('size', DOWNLOAD_SIZE);
	return {status: 'found', url: download.href, size};
}
