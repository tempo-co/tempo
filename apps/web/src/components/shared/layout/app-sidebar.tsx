import {Link, useMatchRoute} from '@tanstack/react-router';
import {ChevronsUpDown, CreditCard, Home, LogOut, Settings, WalletCards} from 'lucide-react';

import {Avatar, AvatarFallback} from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {useCurrentUser} from '@/hooks/use-current-user';
import {useLogOut} from '@/hooks/use-logout';
import {cn} from '@/utils/cn';

const navItems = [
  {label: 'Home', route: '/', icon: Home},
  {label: 'Bank Accounts', route: '/bank-accounts', icon: WalletCards},
  {label: 'Transactions', route: '/transactions', icon: CreditCard},
];

export function AppSidebar() {
  const {isMobile} = useSidebar();
  const {logOut, isPending} = useLogOut();
  const matchRoute = useMatchRoute();

  const {currentUser} = useCurrentUser({skipFetch: true});

  if (currentUser) {
    return (
      <Sidebar collapsible='icon'>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Flair</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton asChild>
                        <Link to={item.route} className={cn(isActive && 'bg-sidebar-accent')}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size='lg'
                    className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                  >
                    <Avatar className='h-8 w-8 rounded-lg'>
                      <AvatarFallback className='rounded-lg'>CN</AvatarFallback>
                    </Avatar>
                    <div className='grid flex-1 text-left text-sm leading-tight'>
                      <span className='truncate font-semibold'>{currentUser.username}</span>
                      <span className='truncate text-xs'>{currentUser.email}</span>
                    </div>
                    <ChevronsUpDown className='ml-auto size-4' />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className='w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg'
                  side={isMobile ? 'bottom' : 'right'}
                  align='end'
                  sideOffset={4}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <Link to='/settings/account' className='cursor-pointer'>
                        <Settings className='mr-2 h-4 w-4' />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => logOut()}
                    className='cursor-pointer'
                    disabled={isPending}
                  >
                    <LogOut className='mr-2 h-4 w-4' />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }
}
