import type {InfiniteData} from '@tanstack/react-query';
import type {BankTransactionsResponse} from '@tempo/contracts';

/**
 * A cached transaction list: every page "Load more" fetched so far, or one page in caches saved for offline use
 * before the list loaded more in place.
 */
export type CachedTransactionList =
  BankTransactionsResponse | InfiniteData<BankTransactionsResponse>;

/** The pages a cached list holds, in order. */
export const listedPages = (list: CachedTransactionList | undefined): BankTransactionsResponse[] =>
  !list ? [] : 'pages' in list ? list.pages : [list];

/** The list with `update` applied to each of its pages, in the shape it was cached in. */
export const mapListedPages = (
  list: CachedTransactionList,
  update: (page: BankTransactionsResponse) => BankTransactionsResponse,
): CachedTransactionList =>
  'pages' in list ? {...list, pages: list.pages.map(update)} : update(list);
