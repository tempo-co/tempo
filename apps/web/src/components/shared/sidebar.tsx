import {Link} from '@tanstack/react-router';
import {ChevronLeft, CreditCard, LayoutGrid, LogOut, Settings, WalletCards} from 'lucide-react';
import {useEffect} from 'react';

import {Avatar, AvatarFallback} from '@/components/ui/avatar';
import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useCurrentUser} from '@/hooks/use-current-user';
import {useLocalStorage} from '@/hooks/use-local-storage';
import {useLogOut} from '@/hooks/use-logout';
import {cn} from '@/utils/cn';

const links = [
  {to: '/dashboard', label: 'Dashboard', icon: LayoutGrid},
  {to: '/accounts', label: 'Accounts', icon: WalletCards},
  {to: '/transactions', label: 'Transactions', icon: CreditCard},
];

export function SideBar() {
  const [isOpen, setIsOpen] = useLocalStorage<boolean>('sidebar', false);
  const {currentUser} = useCurrentUser();
  const logOut = useLogOut();

  useEffect(() => {
    localStorage.setItem('sidebar', JSON.stringify(isOpen));
  }, [isOpen]);

  return (
    <TooltipProvider delayDuration={0}>
      <div className='flex'>
        <div
          className={cn(
            'bg-card px-3 py-4 h-screen flex flex-col justify-between transition-all duration-100',
            isOpen ? 'w-52' : 'w-16',
          )}
        >
          <div>
            <div className='flex justify-between transition-all duration-1000'>
              {isOpen && (
                <Button asChild variant='ghost'>
                  <Link to='/' className='flex items-center group w-fit'>
                    <img
                      src='/src/assets/logo.png'
                      alt='Flair logo'
                      className='w-6 transition-transform duration-200 group-hover:rotate-90'
                    />
                    <h1 className='text-2xl font-semibold tracking-tight ml-2'>Flair</h1>
                  </Link>
                </Button>
              )}
              <Button onClick={() => setIsOpen(!isOpen)} size='icon' variant='ghost'>
                <div
                  className={cn(
                    'transform transition-transform duration-200',
                    !isOpen && 'rotate-180',
                  )}
                >
                  <ChevronLeft />
                </div>
              </Button>
            </div>
            <Separator className='my-4' />
            <div className='grid gap-2 items-start'>
              {links.map(({to, label, icon: Icon}) => (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size={isOpen ? 'default' : 'icon'}
                      className={cn('gap-2 w-full', isOpen ? 'justify-start' : 'justify-center')}
                      asChild
                    >
                      <Link to={to} activeProps={{className: 'bg-secondary rounded-md'}}>
                        <Icon className='w-5 h-5' />
                        {isOpen && label}
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  {!isOpen && <TooltipContent side='right'>{label}</TooltipContent>}
                </Tooltip>
              ))}
            </div>
          </div>
          <div>
            <Separator className='my-4' />
            <Popover>
              <Tooltip>
                <PopoverTrigger asChild>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      className={cn(
                        'flex items-center gap-2 text-sm w-full',
                        isOpen ? 'justify-start px-1' : 'w-10 rounded-full px-4 py-4',
                      )}
                    >
                      <Avatar className='h-8 w-8'>
                        <AvatarFallback>JD</AvatarFallback>
                      </Avatar>
                      {isOpen && <p>{currentUser?.name}</p>}
                    </Button>
                  </TooltipTrigger>
                </PopoverTrigger>
                <PopoverContent asChild>
                  <div
                    className={cn(
                      'flex flex-col gap-2 w-[--radix-popover-trigger-width] !p-2 mb-1',
                      !isOpen && 'w-44 ml-2',
                    )}
                  >
                    <Button variant='ghost' className='w-full justify-start'>
                      <Settings className='mr-2 w-5 h-5' />
                      Settings
                    </Button>
                    <Button
                      variant='ghost'
                      className='w-full justify-start'
                      onClick={() => logOut()}
                    >
                      <LogOut className='mr-2 w-5 h-5' />
                      Log out
                    </Button>
                  </div>
                </PopoverContent>
                {!isOpen && <TooltipContent side='right'>{currentUser?.name}</TooltipContent>}
              </Tooltip>
            </Popover>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
