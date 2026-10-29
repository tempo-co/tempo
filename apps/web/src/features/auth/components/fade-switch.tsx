import {AnimatePresence, motion} from 'framer-motion';

import {switchContentVariants} from '../constants/animations';

type FadeSwitchProps = {
  /** A new key fades the old content out before the new content fades in. */
  viewKey: string;
  className?: string;
  wrapperClassName?: string;
  layout?: boolean;
  role?: 'alert' | 'status';
  'aria-live'?: 'assertive' | 'polite';
  children: React.ReactNode;
};

/** Cross-fades the auth screens' content when it switches to another view. */
export function FadeSwitch({
  viewKey,
  className,
  wrapperClassName = 'relative flex flex-col',
  layout,
  role,
  'aria-live': ariaLive,
  children,
}: FadeSwitchProps) {
  return (
    <div className={wrapperClassName}>
      <AnimatePresence initial={false} mode='wait'>
        <motion.div
          key={viewKey}
          variants={switchContentVariants}
          initial='hidden'
          animate='visible'
          exit='exit'
          layout={layout}
          role={role}
          aria-live={ariaLive}
          className={className}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
