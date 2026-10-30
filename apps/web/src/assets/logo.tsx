import {SVGProps, useId} from 'react';

// Same drawing as the installed-app icons in public/: a paper block with a clay quarter sun in its
// top-right corner, on an ink tile with a long 45° shadow (glyph copies clipped to the tile, faded out).
const TILE =
  'M5 2.5H19A2.5 2.5 0 0 1 21.5 5V19A2.5 2.5 0 0 1 19 21.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5Z';
const BLOCK =
  'M10.7 5A8.3 8.3 0 0 0 19 13.3V16.8A2.2 2.2 0 0 1 16.8 19H7.2A2.2 2.2 0 0 1 5 16.8V7.2A2.2 2.2 0 0 1 7.2 5Z';
const SUN = 'M12 5H16.8A2.2 2.2 0 0 1 19 7.2V12A7 7 0 0 1 12 5Z';
const GLYPH = 'translate(12 12) scale(0.84) translate(-12 -12)';
const SHADOW_STEPS = Array.from({length: 83}, (_, i) => ((i + 1) * 0.12).toFixed(2));

const Logo = (props: SVGProps<SVGSVGElement>) => {
  const id = useId();
  const ref = (name: string) => `${id}-${name}`;
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='1rem'
      height='1rem'
      viewBox='0 0 24 24'
      role='img'
      aria-hidden='true'
      {...props}
    >
      <defs>
        <linearGradient
          id={ref('block')}
          gradientUnits='userSpaceOnUse'
          x1='5'
          y1='5'
          x2='19'
          y2='19'
        >
          <stop offset='0' stopColor='#FBF8F2' />
          <stop offset='1' stopColor='#E3D8C6' />
        </linearGradient>
        <linearGradient
          id={ref('sun')}
          gradientUnits='userSpaceOnUse'
          x1='12'
          y1='5'
          x2='19'
          y2='12'
        >
          <stop offset='0' stopColor='#E59A7B' />
          <stop offset='1' stopColor='#BD654B' />
        </linearGradient>
        <linearGradient id={ref('fade')} x1='0.3' y1='0.3' x2='1' y2='1'>
          <stop offset='0' stopColor='#fff' />
          <stop offset='1' stopColor='#fff' stopOpacity='0' />
        </linearGradient>
        <clipPath id={ref('clip')}>
          <path d={TILE} />
        </clipPath>
        <mask id={ref('mask')}>
          <rect width='24' height='24' fill={`url(#${ref('fade')})`} />
        </mask>
        <g id={ref('glyph')} transform={GLYPH}>
          <path d={BLOCK} />
          <path d={SUN} />
        </g>
      </defs>
      <path fill='#28252B' d={TILE} />
      <g clipPath={`url(#${ref('clip')})`} mask={`url(#${ref('mask')})`} fill='#19171C'>
        {SHADOW_STEPS.map((step) => (
          <use key={step} href={`#${ref('glyph')}`} transform={`translate(${step} ${step})`} />
        ))}
      </g>
      <g transform={GLYPH}>
        <path fill={`url(#${ref('block')})`} d={BLOCK} />
        <path fill={`url(#${ref('sun')})`} d={SUN} />
      </g>
    </svg>
  );
};
export default Logo;
