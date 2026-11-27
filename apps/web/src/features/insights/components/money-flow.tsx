import {isBankTransactionCategory} from '@wisp/contracts';
import type {CSSProperties} from 'react';

import {BANK_TRANSACTION_CATEGORY_META} from '@/features/banking/utils/bank-transaction-category-meta';
import {pct, wholeCents} from '@/features/dashboard/utils/format';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import type {MoneyFlow, MoneyFlowNode} from '../utils/money-flow';

/** Room per node, so its two-line label fits; the diagram is never shorter than {@link MIN_HEIGHT}. */
const NODE_ROOM = 44;
const MIN_HEIGHT = 240;
/** Between nodes on one side. */
const GAP = 8;
/** A label's height: a name over its amount. */
const LABEL = 36;

/** A node's colour: its category's, green for income and what was kept, a quiet grey for Other and savings. */
function nodeColor(node: MoneyFlowNode) {
  if (node.kind === 'source' || node.kind === 'other-income' || node.kind === 'kept')
    return 'var(--color-success)';
  if (node.kind === 'category' && node.category && isBankTransactionCategory(node.category))
    return BANK_TRANSACTION_CATEGORY_META[node.category].color;
  return 'var(--color-chart-secondary)';
}

/** On a phone, a stacked bar with its legend; wider, the diagram. */
export function MoneyFlowView({flow, currency}: {flow: MoneyFlow; currency: string | null}) {
  return useIsMobile() ? (
    <MoneyFlowBar flow={flow} currency={currency} />
  ) : (
    <MoneyFlowDiagram flow={flow} currency={currency} />
  );
}

type Placed = MoneyFlowNode & {
  /** The node's bar, in px from the top. */
  y: number;
  h: number;
  /** Where its band meets the middle bar. */
  join: number;
  /** Its label's top, moved down or up so labels never overlap. */
  labelY: number;
};

/** Each node stacked with a gap, its band joining the middle bar without one, and labels kept apart. */
function place(nodes: MoneyFlowNode[], scale: number, height: number): Placed[] {
  let y = 0;
  let join = 0;
  const placed = nodes.map((node) => {
    const h = Math.max(2, node.cents * scale);
    const item = {...node, y, h, join, labelY: y + h / 2 - LABEL / 2};
    y += h + GAP;
    join += node.cents * scale;
    return item;
  });
  // Down past the one above, then back up from the bottom edge.
  for (let index = 0; index < placed.length; index++)
    placed[index].labelY = Math.max(
      placed[index].labelY,
      index === 0 ? 0 : placed[index - 1].labelY + LABEL,
    );
  for (let index = placed.length - 1; index >= 0; index--)
    placed[index].labelY = Math.min(
      placed[index].labelY,
      index === placed.length - 1 ? height - LABEL : placed[index + 1].labelY - LABEL,
    );
  return placed;
}

/** A band from one side's node to the middle bar, drawn on a 100-wide box stretched to its column. */
function band(fromTop: number, fromBottom: number, toTop: number, toBottom: number) {
  return `M0,${fromTop} C50,${fromTop} 50,${toTop} 100,${toTop} L100,${toBottom} C50,${toBottom} 50,${fromBottom} 0,${fromBottom} Z`;
}

/**
 * Income by source on the left runs through the middle bar into spending by category and what was kept on the right,
 * every node as tall as its money. Labels are text beside each side, so long names truncate instead of shrinking.
 */
function MoneyFlowDiagram({flow, currency}: {flow: MoneyFlow; currency: string | null}) {
  const count = Math.max(flow.sources.length, flow.targets.length);
  const height = Math.max(MIN_HEIGHT, count * NODE_ROOM);
  const scale = (height - GAP * (count - 1)) / flow.total;
  const left = place(flow.sources, scale, height);
  const right = place(flow.targets, scale, height);
  const middle = flow.total * scale;
  const style = {height} as CSSProperties;

  return (
    <div className='grid grid-cols-[minmax(0,10rem)_minmax(4rem,1fr)_0.75rem_minmax(4rem,1fr)_minmax(0,13rem)] gap-0'>
      <NodeColumn nodes={left} side='left' currency={currency} style={style} />
      <svg
        aria-hidden='true'
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio='none'
        className='w-full'
        style={style}
      >
        {left.map((node) => (
          <path
            key={node.key}
            d={band(node.y, node.y + node.h, node.join, node.join + node.cents * scale)}
            fill={nodeColor(node)}
            fillOpacity={0.2}
          />
        ))}
      </svg>
      <div aria-hidden='true' style={style}>
        <div className='rounded-xs bg-foreground' style={{height: middle}} />
      </div>
      <svg
        aria-hidden='true'
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio='none'
        className='w-full'
        style={style}
      >
        {right.map((node) => (
          <path
            key={node.key}
            d={band(node.join, node.join + node.cents * scale, node.y, node.y + node.h)}
            fill={nodeColor(node)}
            fillOpacity={0.2}
          />
        ))}
      </svg>
      <NodeColumn nodes={right} side='right' currency={currency} style={style} />
    </div>
  );
}

function NodeColumn({
  nodes,
  side,
  currency,
  style,
}: {
  nodes: Placed[];
  side: 'left' | 'right';
  currency: string | null;
  style: CSSProperties;
}) {
  return (
    <ul
      aria-label={side === 'left' ? 'Came in' : 'Went to'}
      className='relative min-w-0'
      style={style}
    >
      {nodes.map((node) => (
        <li
          key={node.key}
          data-testid={side === 'left' ? 'money-flow-source' : 'money-flow-target'}
        >
          <span
            aria-hidden='true'
            className={cn('absolute w-2 rounded-xs', side === 'left' ? 'right-0' : 'left-0')}
            style={{top: node.y, height: node.h, background: nodeColor(node)}}
          />
          <span
            className={cn(
              'absolute flex w-full flex-col',
              side === 'left' ? 'right-0 items-end pr-4 text-right' : 'left-0 pl-4',
            )}
            style={{top: node.labelY, height: LABEL}}
          >
            <span className='max-w-full truncate text-body-small'>{node.label}</span>
            <span className='max-w-full truncate numeric text-caption leading-4 text-muted-foreground'>
              {wholeCents(node.cents, currency)}
              {side === 'right' && ` · ${pct(node.share)}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The phone's form: one bar split by where income went, then each part's name, amount and share. */
function MoneyFlowBar({flow, currency}: {flow: MoneyFlow; currency: string | null}) {
  return (
    <div className='grid gap-3'>
      <div aria-hidden='true' className='flex h-4 overflow-hidden rounded-sm bg-muted'>
        {flow.targets.map((node) => (
          <span
            key={node.key}
            className='h-full border-r border-card last:border-r-0'
            style={{width: `${(node.cents / flow.total) * 100}%`, background: nodeColor(node)}}
          />
        ))}
      </div>
      <ul aria-label='Went to' className='grid gap-1'>
        {flow.targets.map((node) => (
          <li
            key={node.key}
            data-testid='money-flow-target'
            className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 text-body-small'
          >
            <span
              aria-hidden='true'
              className='size-2.5 rounded-xs'
              style={{background: nodeColor(node)}}
            />
            <span className='wrap-break-word'>{node.label}</span>
            <span className='numeric whitespace-nowrap text-muted-foreground'>
              {wholeCents(node.cents, currency)} · {pct(node.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
