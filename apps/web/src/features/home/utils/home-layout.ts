/** Home's cards. The main column holds the figures; the rail what needs the owner and what comes next. */
export const HOME_CARDS = {
  pace: {name: 'Spending pace', zone: 'main'},
  categories: {name: 'Top categories this month', zone: 'main'},
  accounts: {name: 'Accounts', zone: 'main'},
  recent: {name: 'Recent transactions', zone: 'main'},
  data: {name: 'Your data', zone: 'rail'},
  todo: {name: 'To do', zone: 'rail'},
  coming: {name: 'Coming up', zone: 'rail'},
} as const satisfies Record<string, {name: string; zone: 'main' | 'rail'}>;

export type HomeCardId = keyof typeof HOME_CARDS;

/** The rail's cards that lead on a phone, above the main ones; the rest of the rail follows them. */
const PHONE_FIRST: readonly HomeCardId[] = ['data', 'todo'];

export type HomeLayout = {order: HomeCardId[]; hidden: HomeCardId[]};

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  order: ['pace', 'categories', 'accounts', 'recent', 'data', 'todo', 'coming'],
  hidden: [],
};

const isCard = (value: unknown): value is HomeCardId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(HOME_CARDS, value);

/**
 * A saved layout, made whole: unknown cards dropped, and cards it does not name (added since it was saved) in their
 * default place. Anything unreadable is the default.
 */
export function readHomeLayout(saved: string | null): HomeLayout {
  let parsed: unknown;
  try {
    parsed = saved === null ? null : JSON.parse(saved);
  } catch {
    return DEFAULT_HOME_LAYOUT;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_HOME_LAYOUT;
  const {order, hidden} = parsed as {order?: unknown; hidden?: unknown};
  const named = [...new Set(Array.isArray(order) ? order.filter(isCard) : [])];
  const missing = DEFAULT_HOME_LAYOUT.order.filter((card) => !named.includes(card));
  return {
    order: [...named, ...missing],
    hidden: [...new Set(Array.isArray(hidden) ? hidden.filter(isCard) : [])],
  };
}

/** The cards shown, by column on a wide screen. */
export function visibleCards({order, hidden}: HomeLayout) {
  const shown = order.filter((card) => !hidden.includes(card));
  return {
    main: shown.filter((card) => HOME_CARDS[card].zone === 'main'),
    rail: shown.filter((card) => HOME_CARDS[card].zone === 'rail'),
  };
}

/**
 * The cards shown in one column on a phone, in runs a card moves within: Your data and To do first, then the main
 * cards, then the rest of the rail.
 */
export function phoneRuns(layout: HomeLayout): HomeCardId[][] {
  const {main, rail} = visibleCards(layout);
  const first = rail.filter((card) => PHONE_FIRST.includes(card));
  return [first, main, rail.filter((card) => !first.includes(card))].filter(
    (run) => run.length > 0,
  );
}

/**
 * Swaps `card` with the card before (`-1`) or after (`1`) it in `run`, the shown cards it moves among; at either end
 * of the run, no change.
 */
export function moveCard(
  layout: HomeLayout,
  run: readonly HomeCardId[],
  card: HomeCardId,
  step: -1 | 1,
): HomeLayout {
  const neighbour = run[run.indexOf(card) + step];
  if (!neighbour) return layout;
  const order = [...layout.order];
  const from = order.indexOf(card);
  const to = order.indexOf(neighbour);
  [order[from], order[to]] = [order[to], order[from]];
  return {...layout, order};
}

export function setCardHidden(layout: HomeLayout, card: HomeCardId, hide: boolean): HomeLayout {
  const hidden = layout.hidden.filter((item) => item !== card);
  return {...layout, hidden: hide ? [...hidden, card] : hidden};
}
