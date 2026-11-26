import {readFileSync} from 'node:fs';

/** The shipped theme file, read so specs can resolve the colour each utility gives in light and dark. */
export const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

export type Theme = 'light' | 'dark';

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

export const blocks = {
  theme: declarations('@theme'),
  root: declarations(':root'),
  dark: declarations('.dark'),
};

export function lookup(property: string, theme: Theme) {
  return (
    (theme === 'dark' ? blocks.dark.get(property) : undefined) ??
    blocks.root.get(property) ??
    blocks.theme.get(property)
  );
}

/** The colour a property ends at, following `var()` through the layers. */
export function resolve(property: string, theme: Theme, seen: string[] = []): string {
  const value = lookup(property, theme);
  if (value === undefined)
    throw new Error(`${property} is not defined (${[...seen, property].join(' → ')})`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) return resolve(reference[1], theme, [...seen, property]);
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${property} is "${value}", not a #rrggbb colour`);
  return value.toUpperCase();
}

/** A Tailwind colour name such as `muted-foreground`, resolved for one theme. */
export const utility = (name: string, theme: Theme) => resolve(`--color-${name}`, theme);
