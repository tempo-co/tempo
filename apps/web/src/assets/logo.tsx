import {SVGProps} from 'react';

// The Wisp symbol's fills are fixed brand colours in every theme, not theme roles (DESIGN.md, Brand).
// eslint-disable-next-line design/tokens -- the logo's Midnight is a fixed brand colour, not a theme role
const MIDNIGHT = '#232B66';
// eslint-disable-next-line design/tokens -- the reversed logo's bars are fixed white, not a theme role
const WHITE = '#FFFFFF';
// eslint-disable-next-line design/tokens -- Rose appears only in the logo, as a fixed brand colour
const ROSE = '#D9577A';

// The Wisp symbol, copied from the masters `wisp-symbol.svg` (light) and `wisp-symbol-reversed.svg` (dark).
const Logo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='1rem'
    height='1rem'
    viewBox='0 0 176 154'
    role='img'
    aria-hidden='true'
    {...props}
  >
    <g className='dark:hidden'>
      <rect x='0' y='66' width='44' height='88' rx='22' fill={MIDNIGHT} />
      <rect x='66' y='32' width='44' height='122' rx='22' fill={MIDNIGHT} />
      <rect x='132' y='66' width='44' height='88' rx='22' fill={MIDNIGHT} />
    </g>
    <g className='hidden dark:inline'>
      <rect x='0' y='66' width='44' height='88' rx='22' fill={WHITE} />
      <rect x='66' y='32' width='44' height='122' rx='22' fill={WHITE} />
      <rect x='132' y='66' width='44' height='88' rx='22' fill={WHITE} />
    </g>
    <circle cx='154' cy='22' r='22' fill={ROSE} />
  </svg>
);
export default Logo;
