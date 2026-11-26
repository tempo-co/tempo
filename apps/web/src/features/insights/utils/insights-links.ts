import {DEFAULT_PERIOD} from './insights-period';

/**
 * Where a category's and a month's own pages live, carrying the period. The pages come with the category and month
 * pages' change; until then these addresses are plain links.
 */
const withPeriod = (path: string, period: string) =>
  `${import.meta.env.BASE_URL}${path}${period === DEFAULT_PERIOD ? '' : `?period=${period}`}`;

export const categoryPageHref = (category: string, period: string) =>
  withPeriod(`insights/categories/${encodeURIComponent(category)}`, period);

export const monthPageHref = (month: string, period: string) =>
  withPeriod(`insights/months/${month}`, period);
