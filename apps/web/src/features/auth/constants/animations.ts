import {Variants} from 'framer-motion';

export const switchContentVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
    transition: {
      duration: 0.25,
      ease: [0.4, 0.0, 0.2, 1],
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: [0.2, 0.0, 0.0, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: 0.25,
      ease: [0.4, 0.0, 0.2, 1],
    },
  },
};

export const cardVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -10,
    scale: 0.99,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 1, 0.5, 1],
    },
  },
};
