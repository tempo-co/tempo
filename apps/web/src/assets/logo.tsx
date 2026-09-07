import {SVGProps} from 'react';

const Logo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='1rem'
    height='1rem'
    viewBox='0 0 24 24'
    role='img'
    aria-hidden='true'
    {...props}
  >
    {/* face plane: follows surrounding text color, so the mark adapts to light/dark automatically */}
    <path
      fill='currentColor'
      d='M5 2.5H19A2.5 2.5 0 0 1 21.5 5V19A2.5 2.5 0 0 1 19 21.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5Z'
    />
    {/* offset plane (clay accent) with rounded top-right corner */}
    <path fill='hsl(var(--clay))' d='M14.2 2.5H19A2.5 2.5 0 0 1 21.5 5V9.7H14.2Z' />
    {/* seam sliver: background color, the visible fold cut */}
    <path fill='hsl(var(--background))' d='M14.2 2.5H16.3V6.6H14.2Z' />
  </svg>
);
export default Logo;
