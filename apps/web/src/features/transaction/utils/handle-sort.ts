import {UseNavigateResult} from '@tanstack/react-router';
import {SortingState} from '@tanstack/react-table';

import {SortField, SortOrder, TransactionSortParams} from '../types/search-params';

export function createSortingHandler(
  setSort: React.Dispatch<React.SetStateAction<TransactionSortParams>>,
  navigate: UseNavigateResult<'/transactions'>,
) {
  return (updaterOrValue: SortingState | ((prev: SortingState) => SortingState)) => {
    setSort((prevSort) => {
      const currentSorting = mapSortToSortingState(prevSort);
      const updatedSorting =
        typeof updaterOrValue === 'function' ? updaterOrValue(currentSorting) : updaterOrValue;
      const newSort = mapSortingStateToSort(updatedSorting);

      void navigate({search: (prev) => ({...prev, sort: newSort})});
      return newSort;
    });
  };
}

export function mapSortToSortingState(sort: TransactionSortParams): SortingState {
  if (sort && sort.by && sort.order) {
    return [{id: sort.by, desc: sort.order === SortOrder.DESC}];
  }
  return [];
}

function mapSortingStateToSort(sortingState: SortingState): TransactionSortParams | undefined {
  if (sortingState.length > 0) {
    const s = sortingState[0];
    return {by: s.id as SortField, order: s.desc ? SortOrder.DESC : SortOrder.ASC};
  }
  return undefined;
}
