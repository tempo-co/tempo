import {minutes} from '@nestjs/throttler';

/**
 * Browsing months or paging through results sends one request per view, and every month or page
 * shares one per-route allowance, so these reads need more than the global default.
 */
export const BROWSING_THROTTLE = {default: {limit: 300, ttl: minutes(1)}};
