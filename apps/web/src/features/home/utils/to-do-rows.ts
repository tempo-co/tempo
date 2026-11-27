/**
 * One thing that needs the owner. Each kind has its own view in the To do card; a new kind (an import reminder, an AI
 * question) adds a member here and a view there.
 */
export type ToDoRow =
  {kind: 'check'; count: number} | {kind: 'setup'; done: number; total: number; next: string};

/** The steps of setting up whose features exist, in order. */
function setupSteps({hasData, toCheck}: {hasData: boolean; toCheck: number}) {
  return [
    {label: 'Import a statement', done: hasData},
    {label: 'Check your categories', done: hasData && toCheck === 0},
  ];
}

/** What needs the owner, most pressing first: transactions to check, then the setup steps still open. */
export function toDoRows({hasData, toCheck}: {hasData: boolean; toCheck: number}): ToDoRow[] {
  const rows: ToDoRow[] = [];
  if (toCheck > 0) rows.push({kind: 'check', count: toCheck});
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
