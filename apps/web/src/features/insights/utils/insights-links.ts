import type {InsightsPeriodSearch} from '../types/insights-search';
import {DEFAULT_PERIOD} from './insights-period';

/**
 * A period as the address keeps it: left out when it is the default, and a year as a number, so the address reads
 * `?period=2025` rather than a quoted string.
 */
export function periodSearch(period: string): InsightsPeriodSearch {
  if (period === DEFAULT_PERIOD) return {};
  return {period: /^\d+$/.test(period) ? Number(period) : period};
}
