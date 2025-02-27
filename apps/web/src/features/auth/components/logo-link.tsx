import {Link} from '@tanstack/react-router';

import logo from '@/assets/logo.png';

export function LogoLink() {
  return (
    <Link to='/' className='group mb-8 flex w-fit items-center p-4'>
      <img
        src={logo}
        alt='Flair logo'
        className='w-8 transition-transform duration-300 group-hover:rotate-90'
      />
      <h1 className='ml-3 text-4xl font-semibold tracking-tight'>Flair</h1>
    </Link>
  );
}
