import {motion} from 'framer-motion';

import {LogoLink} from '@/components/shared/layout/logo-link';

import {cardVariants} from '../constants/animations';

type AuthLayoutProps = {
  title: string;
  children: React.ReactNode;
  disabledLogoLink?: boolean;
};

export function AuthLayout({title, children, disabledLogoLink = false}: AuthLayoutProps) {
  return (
    <div
      data-testid='auth-page'
      className='auth-page relative flex min-h-dvh w-full flex-col items-center justify-center overflow-x-hidden bg-background px-4 py-3 sm:px-6 sm:py-8'
    >
      <div className='relative z-10 flex w-full max-w-[26rem] flex-col items-center'>
        <div className='auth-header mb-3 flex flex-col items-center gap-2 text-center sm:mb-6 sm:gap-4'>
          <LogoLink
            className='flex h-11 w-11 items-center justify-center text-foreground'
            disabled={disabledLogoLink}
          />
          <motion.h1
            id='auth-title'
            key={title}
            initial={{opacity: 0, y: 5}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -5}}
            transition={{duration: 0.3, ease: 'easeOut'}}
            className='text-xl font-semibold leading-tight tracking-tight'
          >
            {title}
          </motion.h1>
        </div>
        <motion.section
          variants={cardVariants}
          initial='hidden'
          animate='visible'
          layout
          aria-labelledby='auth-title'
          data-testid='auth-content'
          transition={{layout: {duration: 0.3, type: 'spring', bounce: 0.2}}}
          className='auth-card w-full border bg-card p-4 text-card-foreground shadow-sm sm:p-6'
        >
          {children}
        </motion.section>
      </div>
    </div>
  );
}
