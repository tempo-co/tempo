import {useEffect} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {wasToasted} from '@/utils/api';

type NextPage = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  error?: Error | null;
  fetchNextPage: () => Promise<unknown>;
};

/**
 * The next page of a paged list, under its rows: "Load more" while there is one. A later page that fails keeps
 * the rows already loaded and says so in a toast with Retry; the button stays, so it can be tried again there too.
 */
export function LoadMore({query}: {query: NextPage}) {
  // Only these are read, so the list re-renders only when one of them changes.
  const {hasNextPage, isFetchingNextPage, isFetchNextPageError, error, fetchNextPage} = query;

  useEffect(() => {
    // Offline, expired sessions and the like are toasted by the api wrapper already.
    if (!isFetchNextPageError || (error && wasToasted(error))) return;
    toast.error("Couldn't load more.", {
      id: 'load-more-failed',
      action: {label: 'Retry', onClick: () => void fetchNextPage()},
    });
  }, [error, fetchNextPage, isFetchNextPageError]);

  if (!hasNextPage) return null;
  return (
    <Button
      variant='ghost'
      className='w-full text-muted-foreground max-sm:h-11'
      disabled={isFetchingNextPage}
      aria-busy={isFetchingNextPage || undefined}
      onClick={() => void fetchNextPage()}
    >
      Load more
    </Button>
  );
}
