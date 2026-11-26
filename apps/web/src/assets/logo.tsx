import {SVGProps} from 'react';

// The Wisp symbol, copied from the masters `wisp-symbol.svg` (light) and `wisp-symbol-reversed.svg` (dark).
// Its fills are fixed brand colours (Midnight #232B66, Rose #D9577A, white on dark), not theme roles.
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
      <rect x='0' y='66' width='44' height='88' rx='22' fill='#232B66' />
      <rect x='66' y='32' width='44' height='122' rx='22' fill='#232B66' />
      <rect x='132' y='66' width='44' height='88' rx='22' fill='#232B66' />
    </g>
    <g className='hidden dark:inline'>
      <rect x='0' y='66' width='44' height='88' rx='22' fill='#FFFFFF' />
      <rect x='66' y='32' width='44' height='122' rx='22' fill='#FFFFFF' />
      <rect x='132' y='66' width='44' height='88' rx='22' fill='#FFFFFF' />
    </g>
    <circle cx='154' cy='22' r='22' fill='#D9577A' />
  </svg>
);
export default Logo;
