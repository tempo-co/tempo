import type {BankTransactionBreakdownPart} from '@tempo/contracts';

import {categoryLabel} from '@/features/dashboard/utils/format';
import {toCents} from '@/features/dashboard/utils/money';

/** A source or category under this share of income merges into one Other node. */
export const SMALL_SHARE = 0.05;

export type MoneyFlowNode = {
  key: string;
  label: string;
  cents: number;
  /** Of income, or of spending when nothing came in. */
  share: number;
  kind: 'source' | 'other-income' | 'savings' | 'category' | 'other' | 'kept';
  /** A category node's category; a source node's part, for its tile. */
  category?: string;
  source?: BankTransactionBreakdownPart;
};

export type MoneyFlow = {
  /** Income by source, then what came from savings when more went out than came in. */
  sources: MoneyFlowNode[];
  /** Spending by category, largest first, then Other, then what was kept. */
  targets: MoneyFlowNode[];
  /** Cents on the larger side, which the diagram's height stands for. */
  total: number;
};

/**
 * Where a period's money went: income by source on one side, spending by category and what was kept on the other.
 * Sources and categories under {@link SMALL_SHARE} of income merge into one node each, unless only one would; a
 * category holding only refunds takes nothing from income and is left out. Null when nothing came in or went out.
 */
export function buildMoneyFlow({
  income,
  spending,
  sources,
  categories,
}: {
  /** The period's cash flow, in cents. */
  income: number;
  spending: number;
  sources: BankTransactionBreakdownPart[];
  categories: BankTransactionBreakdownPart[];
}): MoneyFlow | null {
  if (income <= 0 && spending <= 0) return null;
  const base = income > 0 ? income : spending;
  const share = (cents: number) => cents / base;
  const kept = income - spending;

  const sourceNodes = merge(
    sources
      .map((part) => ({part, cents: toCents(part.amount)}))
      .filter(({cents}) => cents > 0)
      .map(({part, cents}): MoneyFlowNode => ({
        key: part.key,
        label: part.label,
        cents,
        share: share(cents),
        kind: 'source',
        source: part,
      })),
    (_count, cents) => ({
      key: 'other-income',
      label: 'Other income',
      cents,
      share: share(cents),
      kind: 'other-income',
    }),
  );
  const categoryNodes = merge(
    categories
      .map((part) => ({part, cents: toCents(part.amount)}))
      .filter(({cents}) => cents > 0)
      .map(({part, cents}): MoneyFlowNode => ({
        key: part.key,
        label: categoryLabel(part.key),
        cents,
        share: share(cents),
        kind: 'category',
        category: part.key,
      })),
    (count, cents) => ({
      key: 'other',
      label: `Other (${count} categories)`,
      cents,
      share: share(cents),
      kind: 'other',
    }),
  );
  if (kept < 0)
    sourceNodes.push({
      key: 'savings',
      label: 'From savings',
      cents: -kept,
      share: share(-kept),
      kind: 'savings',
    });
  if (kept > 0)
    categoryNodes.push({key: 'kept', label: 'Kept', cents: kept, share: share(kept), kind: 'kept'});
  const sum = (nodes: MoneyFlowNode[]) => nodes.reduce((total, node) => total + node.cents, 0);
  return {
    sources: sourceNodes,
    targets: categoryNodes,
    total: Math.max(sum(sourceNodes), sum(categoryNodes)),
  };
}

/** Largest first, with the nodes under the small share folded into one, unless only one is. */
function merge(
  nodes: MoneyFlowNode[],
  other: (count: number, cents: number) => MoneyFlowNode,
): MoneyFlowNode[] {
  const sorted = [...nodes].sort((left, right) => right.cents - left.cents);
  const small = sorted.filter((node) => node.share < SMALL_SHARE);
  if (small.length < 2) return sorted;
  const big = sorted.filter((node) => node.share >= SMALL_SHARE);
  return [
    ...big,
    other(
      small.length,
      small.reduce((total, node) => total + node.cents, 0),
    ),
  ];
}
