import {type ClassValue, clsx} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

// The named type styles from src/index.css are font sizes, not text colours, and `card` is a radius.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['page-title', 'section-title', 'card-title', 'label', 'caption'],
      radius: ['card'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
