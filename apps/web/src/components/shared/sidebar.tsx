import {useState} from 'react';
import {Avatar, AvatarFallback} from '../ui/avatar';
import {Separator} from '../ui/separator';
import {ChevronLeft, CreditCard, LayoutGrid, LogOut, Settings, WalletCards} from 'lucide-react';
import {Button} from '../ui/button';
import {cn} from '@/utils/cn';
import {Link} from '@tanstack/react-router';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '../ui/tooltip';
import {Popover, PopoverContent, PopoverTrigger} from '../ui/popover';
import {useCurrentUser} from '@/hooks/use-current-user';
import {useLogOut} from '@/hooks/use-logout';

export function SideBar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const {currentUser} = useCurrentUser();
  const logOut = useLogOut();

  const handleLogOut = () => {
    logOut();
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className='flex'>
        <div
          className={cn(
            'bg-card px-3 py-4 h-screen flex flex-col justify-between transition-all duration-100',
            isCollapsed ? 'w-16' : 'w-52',
          )}
        >
          <div>
            <div className='flex justify-between transition-all duration-1000'>
              {!isCollapsed && (
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
              <Button onClick={() => setIsCollapsed(!isCollapsed)} size='icon' variant='ghost'>
                <div
                  className={cn(
                    'transform transition-transform duration-200',
                    isCollapsed && 'rotate-180',
                  )}
                >
                  <ChevronLeft />
                </div>
              </Button>
            </div>
            <Separator className='my-4' />
            <div className='grid gap-2 items-start'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to='/'>
                    <Button
                      variant='ghost'
                      size={isCollapsed ? 'icon' : 'default'}
                      className={cn(
                        'gap-2 w-full',
                        isCollapsed ? 'justify-center' : 'justify-start',
                      )}
                    >
                      <LayoutGrid className='w-5 h-5' />
                      {!isCollapsed && 'Dashboard'}
                    </Button>
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side='right'>Dashboard</TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to='/accounts'>
                    <Button
                      variant='ghost'
                      size={isCollapsed ? 'icon' : 'default'}
                      className={cn(
                        'gap-2 w-full',
                        isCollapsed ? 'justify-center' : 'justify-start',
                      )}
                    >
                      <WalletCards className='w-5 h-5' />
                      {!isCollapsed && 'Accounts'}
                    </Button>
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side='right'>Accounts</TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to='/transactions'>
                    <Button
                      variant='ghost'
                      size={isCollapsed ? 'icon' : 'default'}
                      className={cn(
                        'gap-2 w-full',
                        isCollapsed ? 'justify-center' : 'justify-start',
                      )}
                    >
                      <CreditCard className='w-5 h-5' />
                      {!isCollapsed && 'Transactions'}
                    </Button>
                  </Link>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side='right'>Transactions</TooltipContent>}
              </Tooltip>
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
                        isCollapsed ? 'w-10 rounded-full px-4 py-4' : 'justify-start px-1',
                      )}
                    >
                      <Avatar className='h-8 w-8'>
                        <AvatarFallback>JD</AvatarFallback>
                      </Avatar>
                      {!isCollapsed && <p>{currentUser?.name}</p>}
                    </Button>
                  </TooltipTrigger>
                </PopoverTrigger>
                <PopoverContent asChild>
                  <div
                    className={cn(
                      'flex flex-col gap-2 w-[--radix-popover-trigger-width] !p-2 mb-1',
                      !isCollapsed ? 'w-[--radix-popover-trigger-width]' : 'w-fit ml-2',
                    )}
                  >
                    <Button variant='ghost' className='w-full justify-start'>
                      <Settings className='mr-2 w-5 h-5' />
                      Settings
                    </Button>
                    <Button variant='ghost' className='w-full justify-start' onClick={handleLogOut}>
                      <LogOut className='mr-2 w-5 h-5' />
                      Log out
                    </Button>
                  </div>
                </PopoverContent>
                {isCollapsed && <TooltipContent side='right'>{currentUser?.name}</TooltipContent>}
              </Tooltip>
            </Popover>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
