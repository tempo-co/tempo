import {type ClassValue, clsx} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

// The named type styles from src/index.css are font sizes, not text colours.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {text: ['page-title', 'section-title', 'card-title', 'label', 'caption']},
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
