// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';

/**
 * Reads the shipped theme file and resolves the colour every Tailwind colour utility gives, in light and
 * dark. DESIGN.md (Foundations, Colour) names the same pairs.
 */
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

type Theme = 'light' | 'dark';

/** Custom properties declared directly in each block whose selector is `name`. */
function declarations(name: string) {
  const found = new Map<string, string>();
  const stack: string[] = [];
  let text = '';
  for (const char of css) {
    if (char === '{') {
      stack.push(text.trim());
      text = '';
    } else if (char === '}') {
      stack.pop();
      text = '';
    } else if (char === ';') {
      const match = text.trim().match(/^(--[\w-]+\*?)\s*:\s*([\s\S]+)$/);
      if (match && stack[stack.length - 1] === name) found.set(match[1], match[2].trim());
      text = '';
    } else {
      text += char;
    }
  }
  return found;
}

const blocks = {theme: declarations('@theme'), root: declarations(':root'), dark: declarations('.dark')};

function lookup(property: string, theme: Theme) {
  return (
    (theme === 'dark' ? blocks.dark.get(property) : undefined) ??
    blocks.root.get(property) ??
    blocks.theme.get(property)
  );
}

/** The colour a property ends at, following `var()` through the layers. */
function resolve(property: string, theme: Theme, seen: string[] = []): string {
  const value = lookup(property, theme);
  if (value === undefined) throw new Error(`${property} is not defined (${[...seen, property].join(' → ')})`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) return resolve(reference[1], theme, [...seen, property]);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${property} is "${value}", not a #rrggbb colour`);
  return value.toUpperCase();
}

/** A Tailwind colour name such as `muted-foreground`, resolved for one theme. */
const utility = (name: string, theme: Theme) => resolve(`--color-${name}`, theme);

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const over = (top: string, alpha: number, below: string) =>
  `#${channels(top)
    .map((c, i) => Math.round(c * alpha + channels(below)[i] * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;

/** A background: a utility, or a utility at an opacity over another (`bg-category-x/10` on a card). */
type Ground = string | {color: string; alpha: number; over: string};
type Pair = {fg: string; on: Ground[]; min: 4.5 | 3; job: string};

const TEXT = 4.5;
const GRAPHIC = 3;
const PAGES = ['background', 'card', 'popover'];
const STATUSES = ['destructive', 'success', 'warning', 'info'];
/** Category tiles are their colour at 10% (`bg-category-x/10`) on a card or the page. */
const CATEGORY_TILE_ALPHA = 0.1;
/** Heat-table cells tint up to 45% of `chart-heat` behind their amount. */
const HEAT_MAX_ALPHA = 0.45;
const CATEGORIES =[...css.matchAll(/^\s*--color-category-([\w-]+):/gm)].map((match) => match[1]);

const PAIRS: Pair[] = [
  {fg: 'foreground', on: [...PAGES, 'muted', 'sunk', 'accent', 'secondary'], min: TEXT, job: 'body text'},
  {fg: 'muted-foreground', on: [...PAGES, 'muted', 'sunk', 'accent'], min: TEXT, job: 'secondary text'},
  {fg: 'card-foreground', on: ['card'], min: TEXT, job: 'card text'},
  {fg: 'popover-foreground', on: ['popover'], min: TEXT, job: 'popover text'},
  {fg: 'accent-foreground', on: ['accent'], min: TEXT, job: 'hovered row text'},
  {fg: 'secondary-foreground', on: ['secondary'], min: TEXT, job: 'secondary button label'},
  {fg: 'primary', on: PAGES, min: TEXT, job: 'links and accent text'},
  {fg: 'primary-foreground', on: ['primary'], min: TEXT, job: 'primary button label'},
  ...STATUSES.flatMap((status): Pair[] => [
    {fg: status, on: [...PAGES, `${status}-muted`], min: TEXT, job: `${status} text, alerts and toasts`},
    {fg: 'muted-foreground', on: [`${status}-muted`], min: TEXT, job: `description in a ${status} toast`},
    {fg: `${status}-foreground`, on: [status], min: TEXT, job: `label on a ${status} fill`},
  ]),
  {fg: 'bank-logo-plate-foreground', on: ['bank-logo-plate'], min: TEXT, job: 'bank initials on the plate'},
  {fg: 'input', on: [...PAGES, 'sunk'], min: GRAPHIC, job: 'control borders'},
  {fg: 'ring', on: [...PAGES, 'sunk'], min: GRAPHIC, job: 'focus rings'},
  {fg: 'chart-primary', on: ['card', 'background'], min: GRAPHIC, job: 'main chart series'},
  {fg: 'chart-secondary-edge', on: ['card', 'background'], min: GRAPHIC, job: 'second chart series outline'},
  {
    fg: 'foreground',
    on: [{color: 'chart-heat', alpha: HEAT_MAX_ALPHA, over: 'card'}],
    min: TEXT,
    job: 'amount on the strongest heat-table cell',
  },
  {fg: 'faint', on: ['card'], min: GRAPHIC, job: 'decorative icons beside text'},
  {fg: 'transaction-tile-foreground', on: ['transaction-tile'], min: GRAPHIC, job: 'icon on a leading tile'},
  ...CATEGORIES.map(
    (category): Pair => ({
      fg: `category-${category}`,
      on: ['card', 'background'].map((page) => ({
        color: `category-${category}`,
        alpha: CATEGORY_TILE_ALPHA,
        over: page,
      })),
      min: GRAPHIC,
      job: 'category icon on its tile',
    }),
  ),
];

const groundColour = (ground: Ground, theme: Theme) =>
  typeof ground === 'string'
    ? utility(ground, theme)
    : over(utility(ground.color, theme), ground.alpha, utility(ground.over, theme));
const groundName = (ground: Ground) =>
  typeof ground === 'string' ? ground : `${ground.color}/${ground.alpha * 100} on ${ground.over}`;

for (const theme of ['light', 'dark'] as const) {
  test(`every declared colour pair is readable in the ${theme} theme`, () => {
    const failures = PAIRS.flatMap(({fg, on, min, job}) =>
      on.flatMap((ground) => {
        const ratio = contrast(utility(fg, theme), groundColour(ground, theme));
        return ratio < min ? [`${fg} on ${groundName(ground)} (${job}): ${ratio.toFixed(2)}:1, needs ${min}:1`] : [];
      }),
    );
    expect(failures).toEqual([]);
  });
}

test('the agreed Wisp values sit at their roles in both themes', () => {
  const anchors: Record<Theme, Record<string, string>> = {
    light: {
      primary: '#232B66',
      'primary-foreground': '#FFFFFF',
      background: '#F5F6FA',
      card: '#FFFFFF',
      sunk: '#EEF0F5',
      border: '#E2E5EE',
      foreground: '#1D2140',
      'muted-foreground': '#5D6275',
      faint: '#8A8FA0',
    },
    dark: {
      primary: '#AEB6F2',
      'primary-foreground': '#14161A',
      background: '#121420',
      card: '#1A1D2B',
      sunk: '#161826',
      border: '#2A2E40',
      foreground: '#EEF0F7',
      'muted-foreground': '#A3A8BA',
      faint: '#767C90',
    },
  };
  for (const theme of ['light', 'dark'] as const) {
    const actual = Object.fromEntries(Object.keys(anchors[theme]).map((name) => [name, utility(name, theme)]));
    expect(actual, theme).toEqual(anchors[theme]);
  }
});

test('Tailwind colours reach the scales only through the role layer', () => {
  const reference = (value: string | undefined) => value?.match(/^var\((--[\w-]+)\)$/)?.[1];
  const isRaw = (value: string | undefined) => value !== undefined && /^#[0-9a-f]{6}$/i.test(value);
  /** Roles are named by job, Primer-style: `--fgColor-muted`, `--bgColor-sunk`, `--focus-outlineColor`. */
  const isRole = (property: string) => /^--(fgColor|bgColor|borderColor|focus|data|categoryColor)-/.test(property);
  /** Scales hold the raw values, the same in both themes. */
  const isScale = (property: string) => !isRole(property) && isRaw(blocks.root.get(property));

  expect(blocks.theme.get('--color-*'), 'Tailwind’s default palette is cleared').toBe('initial');
  const leaks: string[] = [];
  for (const [property, value] of blocks.theme) {
    if (!property.startsWith('--color-') || property === '--color-*') continue;
    const name = reference(value);
    if (!name || isRole(name) || isScale(name)) {
      leaks.push(`${property}: ${value} is not a shadcn-layer name`);
      continue;
    }
    for (const theme of ['light', 'dark'] as const) {
      const role = reference(lookup(name, theme));
      if (!role || !isRole(role)) leaks.push(`${name} (${theme}) does not point at a role`);
      else if (!isScale(reference(lookup(role, theme)) ?? '')) leaks.push(`${role} (${theme}) does not read a scale`);
    }
  }
  for (const block of [blocks.root, blocks.dark]) {
    for (const [property, value] of block) {
      if (isRaw(value) && !isScale(property)) leaks.push(`${property} holds a raw colour outside the scales`);
    }
  }
  expect(leaks).toEqual([]);
});
