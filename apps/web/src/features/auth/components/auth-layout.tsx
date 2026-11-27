import {Link} from '@tanstack/react-router';
import {motion} from 'framer-motion';

import {LogoLink} from '@/components/shared/layout/logo-link';

import {cardVariants} from '../constants/animations';

type AuthLayoutProps = {
  title: string;
  children: React.ReactNode;
  disabledLogoLink?: boolean;
  /** A footer link to the official-addresses page, under the card. */
  officialLink?: boolean;
};

export function AuthLayout({
  title,
  children,
  disabledLogoLink = false,
  officialLink = false,
}: AuthLayoutProps) {
  return (
    <div
      data-testid='auth-page'
      className='auth-page relative flex min-h-dvh w-full flex-col items-center justify-center overflow-x-hidden bg-background px-4 py-3 sm:px-6 sm:py-8'
    >
      <div className='relative z-10 flex w-full max-w-104 flex-col items-center'>
        <div className='auth-header mb-3 flex flex-col items-center gap-2 text-center sm:mb-6 sm:gap-4'>
          <LogoLink
            className='flex size-12 items-center justify-center text-foreground'
            disabled={disabledLogoLink}
          />
          <motion.h1
            id='auth-title'
            key={title}
            initial={{opacity: 0, y: 5}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -5}}
            transition={{duration: 0.3, ease: 'easeOut'}}
            className='text-page-title'
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
          className='auth-card w-full rounded-lg border bg-card p-4 text-card-foreground'
        >
          {children}
        </motion.section>
        {officialLink && (
          <footer className='mt-4 text-center text-body-small'>
            <Link
              to='/official'
              className='inline-flex min-h-11 items-center px-2 text-muted-foreground underline decoration-muted underline-offset-4 hover:text-foreground hover:decoration-foreground'
            >
              Official addresses
            </Link>
          </footer>
        )}
      </div>
    </div>
  );
}
