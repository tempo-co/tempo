/**
 * Categorization and currency conversion finish after a sync without any signal the browser can
 * watch, so Home refetches its financial data on this interval while the tab is visible.
 */
export const HOME_REFRESH_INTERVAL_MS = 30_000;
