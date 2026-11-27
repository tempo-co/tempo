/**
 * One thing that needs the owner. Each kind has its own view in the To do card; a new kind (an import reminder, an AI
 * question) adds a member here and a view there.
 */
export type ToDoRow =
  | {kind: 'check'; count: number}
  | {kind: 'install'}
  | {kind: 'setup'; done: number; total: number; next: string};

/** The steps of setting up whose features exist, in order. */
export function setupSteps({hasData, toCheck}: {hasData: boolean; toCheck: number}) {
  return [
    {label: 'Import a statement', done: hasData},
    {label: 'Check your categories', done: hasData && toCheck === 0},
  ];
}

/**
 * What needs the owner, most pressing first: transactions to check, then installing the app (`install`: a phone that
 * can install it, where the owner has not closed the card), once there is data, then the setup steps still open.
 */
export function toDoRows({
  hasData,
  toCheck,
  install = false,
}: {
  hasData: boolean;
  toCheck: number;
  install?: boolean;
}): ToDoRow[] {
  const rows: ToDoRow[] = [];
  if (toCheck > 0) rows.push({kind: 'check', count: toCheck});
  if (install && hasData) rows.push({kind: 'install'});
  const steps = setupSteps({hasData, toCheck});
  const next = steps.find((step) => !step.done);
  if (next)
    rows.push({
      kind: 'setup',
      done: steps.filter((step) => step.done).length,
      total: steps.length,
      next: next.label.toLowerCase(),
    });
  return rows;
}
