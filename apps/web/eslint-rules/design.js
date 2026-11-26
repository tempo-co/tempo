/**
 * The web app's design-system lint rules (DESIGN.md, Enforcement).
 *
 * - design/tokens: components reach colours and sizes only through the theme's roles and scales. It
 *   reports raw colour literals and Tailwind arbitrary values for type, spacing, size, colour and
 *   radius in string literals, template literals and JSX attribute strings.
 * - design/exceptions: an exception to design/tokens is `// eslint-disable-next-line design/tokens
 *   -- <reason>`. It reports any other disable form naming design/tokens, and one without a reason.
 *   It is its own rule because a disable comment hides what the rule it names reports on its lines.
 */

// A hex colour stands alone or sits in CSS punctuation (`[#fff]`, `1px #fff`, `(#fff,`).
const HEX = /(?<=^|[\s[(,:])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?=$|[\s\]),;/])/gi;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch)\(/gi;

// Attributes and properties whose `#…` value is a fragment or an id, never a colour.
const FRAGMENT_KEYS = new Set(['href', 'to', 'hash', 'id']);

const TYPE = ['text', 'leading', 'tracking', 'font'];
const SPACING = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe'].flatMap((p) => [
  p,
  p.replace('p', 'm'),
]);
const GAPS = ['gap', 'gap-x', 'gap-y', 'space-x', 'space-y'];
const SIZE = ['w', 'h', 'size', 'min-w', 'min-h', 'max-w', 'max-h'];
const SIDES = ['', '-x', '-y', '-t', '-r', '-b', '-l', '-s', '-e'];
const COLOUR = [
  'bg',
  ...SIDES.map((side) => `border${side}`),
  'divide',
  'fill',
  'stroke',
  'ring',
  'ring-offset',
  'outline',
  'decoration',
  'caret',
  'accent',
  'placeholder',
  'from',
  'via',
  'to',
  'shadow',
];
const CORNERS = [
  '',
  '-t',
  '-r',
  '-b',
  '-l',
  '-s',
  '-e',
  '-tl',
  '-tr',
  '-br',
  '-bl',
  '-ss',
  '-se',
  '-es',
  '-ee',
];
const RADIUS = CORNERS.map((corner) => `rounded${corner}`);
const CHECKED_UTILITIES = new Set([...TYPE, ...SPACING, ...GAPS, ...SIZE, ...COLOUR, ...RADIUS]);

const SIZE_UTILITIES = new Set(SIZE);
// Parts of a value that come from the system or the device: a token (`var(--color-chart-1)`), a spacing step
// (`--spacing(4)`), a safe-area inset (`env(safe-area-inset-bottom)`) and the 1px hairline.
const SYSTEM_PARTS = /var\(--[\w-]+\)|--spacing\([\d.]+\)|env\([\w-]+\)|(?<![\d.])1px\b/g;
// Absolute lengths are one-offs. Text-relative lengths (em, ch) also are, except on size utilities, where
// they size a column or a line to the text it holds (`w-[8em]`, `max-w-[60ch]`). Lengths relative to the
// viewport, the container or the parent (dvh, vw, %) have no scale step and pass.
const ABSOLUTE = /\d(?:px|rem|pt|pc|cm|mm|in|q)\b/i;
const TEXT_RELATIVE = /\d(?:em|ch|ex|lh|rlh)\b/i;
// `leading-[1.1]`, `font-[550]`: a bare number on a type utility is a one-off too.
const BARE_NUMBER = /^-?(?:\d*\.)?\d+$/;

function isOneOff(utility, value) {
  const own = value.replace(SYSTEM_PARTS, '');
  if (ABSOLUTE.test(own)) return true;
  if (!SIZE_UTILITIES.has(utility) && TEXT_RELATIVE.test(own)) return true;
  return TYPE.includes(utility) && BARE_NUMBER.test(own);
}

/** The utility of a class token, without its variants (`md:`, `data-[state=open]:`) or `!`/`-`. */
function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    else if (token[i] === ']') depth--;
    else if (token[i] === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, '').replace(/^-/, '');
}

/** Arbitrary-value classes in a string that the design system covers. */
function arbitraryClasses(text) {
  const found = [];
  for (const token of text.split(/\s+/)) {
    const match = utilityOf(token).match(/^([a-z][a-z0-9-]*)-\[(.+)\]$/);
    if (match && CHECKED_UTILITIES.has(match[1]) && isOneOff(match[1], match[2])) found.push(token);
  }
  return found;
}

function rawColours(text) {
  const found = [];
  for (const match of text.matchAll(HEX)) {
    // "Row #123": a number after a word is prose, not a colour.
    if (/^#\d+$/.test(match[0]) && /[a-z]\s$/i.test(text.slice(0, match.index))) continue;
    found.push(match[0]);
  }
  for (const match of text.matchAll(COLOUR_FUNCTION)) found.push(match[0]);
  return found;
}

function keyOf(node) {
  const parent = node.parent;
  if (parent?.type === 'JSXAttribute') return parent.name.name;
  if (parent?.type === 'Property' && parent.value === node)
    return parent.key.name ?? parent.key.value;
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
const tokens = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Colours and sizes come from the theme roles and scales, not raw values (DESIGN.md).',
    },
    schema: [],
    messages: {
      colour:
        "Raw colour '{{value}}': use a colour role class, or var(--color-…) where a value is needed.",
      arbitrary: "One-off value '{{value}}': use a scale value or a named token from index.css.",
    },
  },
  create(context) {
    function check(node, text) {
      if (!FRAGMENT_KEYS.has(keyOf(node))) {
        for (const value of rawColours(text))
          context.report({node, messageId: 'colour', data: {value}});
      }
      for (const value of arbitraryClasses(text))
        context.report({node, messageId: 'arbitrary', data: {value}});
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const parent = node.parent;
        if (parent?.type === 'ImportDeclaration' || parent?.type?.startsWith('Export')) return;
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const exceptions = {
  meta: {
    type: 'problem',
    docs: {description: 'An exception to design/tokens covers one line and says why.'},
    schema: [],
    messages: {
      reason:
        'A design/tokens exception needs a reason: `// eslint-disable-next-line design/tokens -- <why>`.',
      form: 'A design/tokens exception covers one line: use `// eslint-disable-next-line design/tokens -- <why>`.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = comment.value
            .trim()
            .match(/^eslint-disable(-next-line|-line)?\s+(.*)$/s);
          if (!directive) continue;
          const [rules, reason] = directive[2].split(/\s--\s/, 2);
          if (!rules.split(',').some((name) => name.trim() === 'design/tokens')) continue;
          if (directive[1] !== '-next-line') context.report({loc: comment.loc, messageId: 'form'});
          else if (!reason?.trim()) context.report({loc: comment.loc, messageId: 'reason'});
        }
      },
    };
  },
};

export default {rules: {tokens, exceptions}};
