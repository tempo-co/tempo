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
    <div className='relative mx-6 flex h-screen flex-col overflow-hidden bg-background'>
      <div className='absolute inset-0 z-0 bg-[linear-gradient(to_right,theme(colors.border/0.05)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.border/0.1)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_30%,transparent_100%)]' />
      <div className='relative z-10 mt-[20vh] flex flex-col items-center text-center'>
        <LogoLink className='mb-10 h-8 w-8 text-foreground' disabled={disabledLogoLink} />
        <motion.h1
          key={title}
          initial={{opacity: 0, y: 5}}
          animate={{opacity: 1, y: 0}}
          exit={{opacity: 0, y: -5}}
          transition={{duration: 0.3, ease: 'easeOut'}}
          className='text-xl font-medium'
        >
          {title}
        </motion.h1>
      </div>
      <motion.div
        variants={cardVariants}
        initial='hidden'
        animate='visible'
        layout
        transition={{layout: {duration: 0.3, type: 'spring', bounce: 0.2}}}
        className='relative z-10 mx-auto flex w-full max-w-[26rem] flex-col space-y-6 overflow-hidden rounded-lg bg-background p-8 shadow-lg'
      >
        {children}
      </motion.div>
    </div>
  );
}
