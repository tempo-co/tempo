import {useState} from 'react';

type Selection = {key: string; ids: ReadonlySet<string>; anchor: string | null};

/**
 * Rows picked in a list for a bulk action. A plain toggle picks or drops one row and becomes the anchor; a range
 * (Shift-click) picks every row from the anchor to it, in list order. Only rows still listed count, and a new `key`
 * (other filters or order) starts over.
 */
export function useRowSelection(listedIds: readonly string[], key: string) {
  const [selection, setSelection] = useState<Selection>({key, ids: new Set(), anchor: null});
  const current = selection.key === key ? selection : {key, ids: new Set<string>(), anchor: null};
  const selectedIds = listedIds.filter((id) => current.ids.has(id));
  const allSelected = listedIds.length > 0 && selectedIds.length === listedIds.length;

  const toggle = (id: string, {range = false}: {range?: boolean} = {}) => {
    const from = current.anchor ? listedIds.indexOf(current.anchor) : -1;
    const to = listedIds.indexOf(id);
    const ids = new Set(current.ids);
    if (range && from >= 0 && to >= 0) {
      for (const rangeId of listedIds.slice(Math.min(from, to), Math.max(from, to) + 1))
        ids.add(rangeId);
    } else if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    setSelection({key, ids, anchor: id});
  };
  const toggleAll = () =>
    setSelection({key, ids: allSelected ? new Set() : new Set(listedIds), anchor: null});
  const clear = () => setSelection({key, ids: new Set(), anchor: null});

  return {
    selectedIds,
    isSelected: (id: string) => current.ids.has(id),
    allSelected,
    toggle,
    toggleAll,
    clear,
  };
}

export type RowSelection = ReturnType<typeof useRowSelection>;
