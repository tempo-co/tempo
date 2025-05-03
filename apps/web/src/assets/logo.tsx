import {SVGProps} from 'react';

const Logo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    xmlSpace='preserve'
    width='1rem'
    height='1rem'
    viewBox='0 0 1080 1080'
    {...props}
  >
    <rect width='100%' height='100%' fill='transparent' />
    <path
      d='M0 170.833C0 159.327 9.327 150 20.833 150a20.833 20.833 0 0 1 20.834 20.833v8.334A20.833 20.833 0 0 1 20.833 200C9.327 200 0 190.673 0 179.167ZM50 150h41.667v29.167A20.833 20.833 0 0 1 70.833 200C59.327 200 50 190.673 50 179.167Zm0-29.167C50 109.327 59.327 100 70.833 100a20.833 20.833 0 0 1 20.834 20.833V150H50Zm50-100C100 9.327 109.327 0 120.833 0a20.833 20.833 0 0 1 20.834 20.833V50H100ZM100 50h41.667v29.167A20.833 20.833 0 0 1 120.833 100C109.327 100 100 90.673 100 79.167Zm0 120.833c0-11.506 9.327-20.833 20.833-20.833a20.833 20.833 0 0 1 20.834 20.833v8.334A20.833 20.833 0 0 1 120.833 200C109.327 200 100 190.673 100 179.167ZM150 150h41.667v29.167A20.833 20.833 0 0 1 170.833 200C159.327 200 150 190.673 150 179.167Zm0-50h41.667v50H150Zm0-50h41.667v50H150Zm0-29.167C150 9.327 159.327 0 170.833 0a20.833 20.833 0 0 1 20.834 20.833V50H150Z'
      style={{
        stroke: 'none',
        strokeWidth: 1,
        strokeDasharray: 'none',
        strokeLinecap: 'butt',
        strokeDashoffset: 0,
        strokeLinejoin: 'miter',
        strokeMiterlimit: 4,
        fill: 'currentcolor',
        fillRule: 'nonzero',
        opacity: 1,
      }}
      transform='matrix(5.09 0 0 5.09 52.225 31)'
      vectorEffect='non-scaling-stroke'
    />
  </svg>
);
export default Logo;
