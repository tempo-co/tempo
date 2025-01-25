import {Link} from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  LayoutGrid,
  LogOut,
  Settings,
  WalletCards,
} from 'lucide-react';

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
  const [isOpen, setIsOpen] = useLocalStorage<boolean>('sidebar', true);
  const {currentUser} = useCurrentUser();
  const logOut = useLogOut();

  return (
    <TooltipProvider delayDuration={50}>
      <div className='flex'>
        <div
          className={cn(
            'flex h-screen flex-col justify-between bg-card px-3 py-4 transition-all duration-100',
            isOpen ? 'w-52' : 'w-16',
          )}
        >
          <div>
            <div className='flex justify-between transition-all duration-1000'>
              {isOpen && (
                <Button asChild variant='ghost' className='px-3'>
                  <Link to='/' className='group flex w-fit items-center'>
                    <img
                      src='/src/assets/logo.png'
                      alt='Flair logo'
                      className='w-6 transition-transform duration-200 group-hover:rotate-90'
                    />
                    <h1 className='ml-2 text-2xl font-semibold tracking-tight'>Flair</h1>
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
            <div className='grid items-start gap-2'>
              {links.map(({to, label, icon: Icon}) => (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size={isOpen ? 'default' : 'icon'}
                      className={cn(
                        'w-full gap-2',
                        isOpen ? 'justify-start px-[0.65rem]' : 'justify-center',
                      )}
                      asChild
                    >
                      <Link to={to} activeProps={{className: 'bg-muted rounded-md'}}>
                        <Icon className='h-5 w-5' />
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
                        'flex w-full p-5 text-sm',
                        isOpen ? 'justify-between px-[0.375rem]' : 'w-10 rounded-full',
                      )}
                    >
                      <div className='flex items-center'>
                        <Avatar className='h-7 w-7'>
                          <AvatarFallback>JD</AvatarFallback>
                        </Avatar>
                        {isOpen && (
                          <div className='ml-2 flex flex-col items-start leading-none'>
                            <p>{currentUser?.name}</p>
                            <p className='text-xs text-muted-foreground'>{currentUser?.email}</p>
                          </div>
                        )}
                      </div>
                      <ChevronRight className='w-4 text-muted-foreground' />
                    </Button>
                  </TooltipTrigger>
                </PopoverTrigger>
                <PopoverContent asChild>
                  <div
                    className={cn(
                      'mb-1 flex w-[--radix-popover-trigger-width] flex-col gap-2 !p-2',
                      !isOpen && 'ml-2 w-fit',
                    )}
                  >
                    <Button variant='ghost' className='w-full justify-start'>
                      <Settings className='mr-2 h-5 w-5' />
                      Settings
                    </Button>
                    <Button
                      variant='ghost'
                      className='w-full justify-start'
                      onClick={() => logOut()}
                    >
                      <LogOut className='mr-2 h-5 w-5' />
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
