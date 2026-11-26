// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {test} from '@playwright/test';
import tsParser from '@typescript-eslint/parser';
import {RuleTester} from 'eslint';

import design from '../../eslint-rules/design.js';

// Each RuleTester case becomes its own Playwright test.
RuleTester.describe = (name: string, body: () => void) => test.describe(name, body);
RuleTester.it = (name: string, body: () => void) => test(name, body);
RuleTester.itOnly = (name: string, body: () => void) => test.only(name, body);

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {ecmaFeatures: {jsx: true}},
  },
});

// RuleTester registers the rule under test as `rule-to-test/<name>`, so this suite's exception names that id.
const testedTokens = 'rule-to-test/design/tokens';

ruleTester.run('design/tokens', design.rules.tokens, {
  valid: [
    {
      name: 'a role class',
      code: `const a = <p className="text-muted-foreground bg-card p-4 rounded-lg" />;`,
    },
    {
      name: 'a named type style',
      code: `const a = <h1 className="text-page-title md:text-section-title" />;`,
    },
    {name: 'a token read through var()', code: `const fill = 'var(--color-chart-1)';`},
    {
      name: 'an arbitrary value that points at a token',
      code: `const a = 'w-[var(--radix-popover-trigger-width)]';`,
    },
    {
      name: 'a size relative to the viewport or parent',
      code: `const a = 'max-h-[90dvh] sm:max-w-[45%]';`,
    },
    {name: 'a column sized to its text', code: `const a = 'w-[8em] max-w-[60ch]';`},
    {
      name: 'spacing steps, the hairline and the safe area',
      code: `const a = 'max-md:pb-[calc(--spacing(14)+1px+env(safe-area-inset-bottom))]';`,
    },
    {
      name: 'a layout template',
      code: `const a = 'grid-cols-[minmax(0,1fr)_auto] translate-x-[-50%]';`,
    },
    {name: 'a variant selector', code: `const a = 'data-[state=open]:bg-accent [&_svg]:size-4';`},
    {name: 'an in-page link', code: `const a = <a href="#add">Add</a>;`},
    {name: 'a number in prose', code: `const a = 'Row #123 failed';`},
    {
      name: 'a commented exception',
      code: `// eslint-disable-next-line ${testedTokens} -- the logo's brand colour is fixed in every theme\nconst rose = '#E8577A';`,
    },
  ],
  invalid: [
    {
      name: 'an all-digit hex after a border style',
      code: `const a = {border: '1px solid #000'};`,
      errors: [{messageId: 'colour'}],
    },
    {
      name: 'an all-digit hex after a length',
      code: `const a = {boxShadow: '0 1px 2px #000000'};`,
      errors: [{messageId: 'colour'}],
    },
    {
      name: 'a hex inside an arbitrary value',
      code: `const a = <div className="shadow-[0_0_0_1px_#232b66]" />;`,
      errors: [{messageId: 'colour'}],
    },
    {name: 'a raw hex', code: `const a = '#232B66';`, errors: [{messageId: 'colour'}]},
    {
      name: 'a short raw hex in JSX',
      code: `const a = <stop stopColor="#fff" />;`,
      errors: [{messageId: 'colour'}],
    },
    {name: 'an rgb() call', code: 'const a = `rgb(0 0 0 / 0.4)`;', errors: [{messageId: 'colour'}]},
    {
      name: 'an hsl() wrapper',
      code: `const a = 'hsl(var(--border))';`,
      errors: [{messageId: 'colour'}],
    },
    {
      name: 'an oklch() call',
      code: `const a = 'oklch(0.5 0.1 260)';`,
      errors: [{messageId: 'colour'}],
    },
    {
      name: 'an arbitrary text size',
      code: `const a = <p className="text-[13px]" />;`,
      errors: [{messageId: 'arbitrary'}],
    },
    {
      name: 'arbitrary sizes behind variants',
      code: `const a = 'md:!px-[18px] hover:rounded-[10px] max-w-[42rem]';`,
      errors: [{messageId: 'arbitrary'}, {messageId: 'arbitrary'}, {messageId: 'arbitrary'}],
    },
    {
      name: 'an arbitrary colour class',
      code: `const a = 'bg-[#232B66]';`,
      errors: [{messageId: 'colour'}],
    },
    {
      name: 'absolute lengths inside an expression',
      code: `const a = 'max-w-[calc(100vw-2rem)] h-[min(90dvh,56rem)]';`,
      errors: [{messageId: 'arbitrary'}, {messageId: 'arbitrary'}],
    },
    {
      name: 'a one-off type or spacing value',
      code: `const a = 'leading-[1.1] p-[0.5em]';`,
      errors: [{messageId: 'arbitrary'}, {messageId: 'arbitrary'}],
    },
  ],
});

// Exception comments name the real design/tokens, so this suite loads the plugin they refer to.
const exceptionTester = new RuleTester({
  languageOptions: {parser: tsParser},
  plugins: {design},
});

exceptionTester.run('design/exceptions', design.rules.exceptions, {
  valid: [
    {
      name: 'a one-line exception with a reason',
      code: `// eslint-disable-next-line design/tokens -- recharts needs a real value\nconst a = 1;`,
    },
    {
      name: 'a disable for another rule',
      code: `// eslint-disable-next-line no-console\nconst a = 1;`,
    },
  ],
  invalid: [
    {
      name: 'an exception without a reason',
      code: `// eslint-disable-next-line design/tokens\nconst a = 1;`,
      errors: [{messageId: 'reason'}],
    },
    {
      name: 'a same-line exception',
      code: `const a = 1; // eslint-disable-line design/tokens -- reason`,
      errors: [{messageId: 'form'}],
    },
    {
      name: 'a block exception',
      code: `/* eslint-disable design/tokens -- reason */\nconst a = 1;`,
      errors: [{messageId: 'form'}],
    },
  ],
});
