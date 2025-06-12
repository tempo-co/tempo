import {Link} from '@tanstack/react-router';
import {motion} from 'framer-motion';

import Logo from '@/assets/logo';

type LogoLinkProps = {
  className?: string;
  disabled?: boolean;
};

export function LogoLink({className, disabled = false}: LogoLinkProps) {
  return (
    <Link to='/' className={className} disabled={disabled}>
      <motion.div
        whileHover={{scale: 1.07}}
        whileTap={{scale: 0.95}}
        transition={{duration: 0.2, ease: 'easeOut'}}
      >
        <Logo aria-label='Flair logo' className='h-8 w-8 text-foreground' />
      </motion.div>
    </Link>
  );
}
