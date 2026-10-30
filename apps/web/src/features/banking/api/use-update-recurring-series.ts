import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api, wasToasted} from '@/utils/api';

import {recurringQueryKeys} from './recurring-query-keys';

type Change =
  | {kind: 'hidden'; key: string; hidden: boolean}
  | {kind: 'linked'; key: string; linked: boolean; previousName: string};

const request = (change: Change) =>
  change.kind === 'hidden'
    ? {url: `/recurring-series/${change.key}/hidden`, body: {hidden: change.hidden}}
    : {url: `/recurring-series/${change.key}/continuation`, body: {linked: change.linked}};

const inverse = (change: Change): Change =>
  change.kind === 'hidden'
    ? {...change, hidden: !change.hidden}
    : {...change, linked: !change.linked};

function message(change: Change) {
  if (change.kind === 'hidden')
    return change.hidden ? 'Hidden from recurring payments.' : 'Counted as recurring again.';
  return change.linked
    ? `Linked with ${change.previousName} again.`
    : `Unlinked from ${change.previousName}.`;
}

/**
 * Hides a series or unlinks a joined history, and the reverse. Every change offers an undo, so a
 * wrong automatic result is one tap away from fixed. It never changes the transactions themselves.
 */
export const useUpdateRecurringSeries = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<void, HttpError, Change>({
    mutationFn: async (change) => {
      const {url, body} = request(change);
      await api.patch<void>(url, body);
    },
    // Hiding changes what counts, not which payments a series has; linking changes both.
    onSuccess: (_, change) =>
      queryClient.invalidateQueries({
        queryKey: recurringQueryKeys.root,
        predicate: ({queryKey}) => change.kind === 'linked' || queryKey[1] !== 'payments',
      }),
  });

  const save = async (change: Change, undoable: boolean) => {
    try {
      await mutateAsync(change);
    } catch (error) {
      if (!wasToasted(error)) toast.error('Could not save. Please try again.');
      return;
    }
    toast.success(
      message(change),
      undoable ? {action: {label: 'Undo', onClick: () => void save(inverse(change), false)}} : {},
    );
  };

  return {
    update: (change: Change) => save(change, true),
    // Each row has its own mutation, so pending is that row's change.
    isPending,
  };
};
