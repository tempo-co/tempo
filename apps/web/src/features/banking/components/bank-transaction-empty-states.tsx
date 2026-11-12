import {Link, useNavigate} from '@tanstack/react-router';
import {ReceiptText, SearchX} from 'lucide-react';

import {StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import type {BankTransactionFilterParams} from '../types/bank-transaction';
import {isConnectedBank} from '../utils/bank-sync-status';
import {countActiveFilters} from '../utils/drill-filters';

/** The characters of a search the description repeats. */
const SEARCH_SHOWN = 40;

/** The account has no transactions: say where they come from, and offer a bank when none is connected. */
export function NoTransactionsYet() {
  const {bankConnections} = useGetAllBankConnections();
  const needsBank = bankConnections?.filter(isConnectedBank).length === 0;
  return (
    <StateMessage
      previewRows
      icon={ReceiptText}
      title='No transactions yet'
      description={
        needsBank
          ? 'Connect a bank and its transactions appear here after the first sync.'
          : 'They appear here once your banks finish their first sync.'
      }
    >
      {needsBank && (
        <Button asChild>
          <Link to='/bank-connections'>Connect a bank</Link>
        </Button>
      )}
    </StateMessage>
  );
}

/** The search and filters in force match nothing: name them, and offer the ways back out. */
export function NoMatchingTransactions({
  filters,
  onClearFilters,
}: {
  filters: BankTransactionFilterParams;
  onClearFilters: () => void;
}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const filterCount = countActiveFilters(filters);
  const search = filters.search?.trim();
  // A long search is cut short; the search box above still holds all of it.
  const quoted = search
    ? `“${search.length > SEARCH_SHOWN ? `${search.slice(0, SEARCH_SHOWN)}…` : search}”`
    : null;
  // The chips above name the filters, so the description points at them rather than listing them.
  const description = !quoted
    ? 'No transactions match these filters.'
    : filterCount > 0
      ? `Nothing matches ${quoted} with these filters.`
      : `Nothing matches ${quoted}.`;
  // Dropping only the date is a different way out when something else narrows the list too.
  const canWidenDates = Boolean(filters.bookingDate?.from) && (Boolean(search) || filterCount > 1);

  return (
    <StateMessage icon={SearchX} title='No matching transactions' description={description}>
      <Button variant='outline' onClick={onClearFilters}>
        Clear filters
      </Button>
      {canWidenDates && (
        <Button
          variant='ghost'
          onClick={() => void navigate({search: (prev) => ({...prev, bookingDate: undefined})})}
        >
          {search ? 'Search all dates' : 'Show all dates'}
        </Button>
      )}
    </StateMessage>
  );
}
