import {useState} from 'react';

type Selection = {
  key: string;
  ids: ReadonlySet<string>;
  anchor: string | null;
  /** Every row the list's filters match, loaded or not. */
  allMatching: boolean;
};

const emptySelection = (key: string): Selection => ({
  key,
  ids: new Set(),
  anchor: null,
  allMatching: false,
});

/**
 * Rows picked in a list for a bulk action. A plain toggle picks or drops one row and becomes the anchor; a range
 * (Shift-click) picks every row from the anchor to it, in list order. Only rows still listed count, and a new `key`
 * (other filters or order) starts over. `selectAllMatching` picks every row the list's filters match, including rows
 * not loaded yet; dropping any row goes back to the loaded rows.
 */
export function useRowSelection(listedIds: readonly string[], key: string) {
  const [selection, setSelection] = useState<Selection>(() => emptySelection(key));
  const current = selection.key === key ? selection : emptySelection(key);
  const selectedIds = current.allMatching
    ? [...listedIds]
    : listedIds.filter((id) => current.ids.has(id));
  const allSelected = listedIds.length > 0 && selectedIds.length === listedIds.length;

  const toggle = (id: string, {range = false}: {range?: boolean} = {}) => {
    const from = current.anchor ? listedIds.indexOf(current.anchor) : -1;
    const to = listedIds.indexOf(id);
    const ids = new Set(current.allMatching ? listedIds : current.ids);
    if (range && from >= 0 && to >= 0) {
      for (const rangeId of listedIds.slice(Math.min(from, to), Math.max(from, to) + 1))
        ids.add(rangeId);
    } else if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    setSelection({key, ids, anchor: id, allMatching: false});
  };
  const toggleAll = () =>
    setSelection(
      allSelected ? emptySelection(key) : {...emptySelection(key), ids: new Set(listedIds)},
    );
  const selectAllMatching = () => setSelection({...emptySelection(key), allMatching: true});
  const clear = () => setSelection(emptySelection(key));

  return {
    selectedIds,
    isSelected: (id: string) => current.allMatching || current.ids.has(id),
    allSelected,
    allMatching: current.allMatching,
    toggle,
    toggleAll,
    selectAllMatching,
    clear,
  };
}

export type RowSelection = ReturnType<typeof useRowSelection>;
