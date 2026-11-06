import {Button} from '@/components/ui/button';

type NextPage = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
};

/**
 * The next page of a paged list, under its rows: "Load more" while there is one. A later page that fails keeps
 * the rows already loaded, says so under them and offers to fetch that page again in the button's place.
 */
export function LoadMore({query}: {query: NextPage}) {
  // Only these are read, so the list re-renders only when one of them changes.
  const {hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage} = query;
  if (!hasNextPage) return null;
  const button = (label: string) => (
    <Button
      variant='ghost'
      className='w-full text-muted-foreground max-sm:h-11'
      disabled={isFetchingNextPage}
      aria-busy={isFetchingNextPage || undefined}
      onClick={() => void fetchNextPage()}
    >
      {label}
    </Button>
  );
  if (!isFetchNextPageError) return button('Load more');
  return (
    <div className='grid gap-1'>
      <p role='status' className='pt-2 text-center text-sm text-muted-foreground'>
        {"Couldn't load more."}
      </p>
      {button('Retry')}
    </div>
  );
}
