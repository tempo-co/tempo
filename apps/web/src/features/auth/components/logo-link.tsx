import {Link} from '@tanstack/react-router';

export function LogoLink() {
  return (
    <Link to='/' className='flex items-center group mb-8 w-fit p-4'>
      <img
        src='/src/assets/logo.png'
        alt='Flair logo'
        className='w-8 transition-transform duration-300 group-hover:rotate-90'
      />
      <h1 className='text-4xl font-semibold tracking-tight ml-3'>Flair</h1>
    </Link>
  );
}
