import {Link, useLocation} from '@tanstack/react-router';
import {ArrowLeftRight, Home, Landmark, LogOut, Settings} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {useLogOut} from '@/hooks/use-logout';
import {cn} from '@/utils/cn';

type NavItem = {
  label: string;
  to: '/' | '/bank-connections' | '/bank-transactions' | '/settings/account';
  /** The route subtree that marks the item active. */
  match: string;
  icon: typeof Home;
};

const navItems: NavItem[] = [
  {label: 'Home', to: '/', match: '/', icon: Home},
  {label: 'Connections', to: '/bank-connections', match: '/bank-connections', icon: Landmark},
  {
    label: 'Transactions',
    to: '/bank-transactions',
    match: '/bank-transactions',
    icon: ArrowLeftRight,
  },
];

const tabItems: NavItem[] = [
  ...navItems,
  {label: 'Settings', to: '/settings/account', match: '/settings', icon: Settings},
];

function useIsActive() {
  // The location being opened, which Link also marks: matchRoute keeps the previous page until the next one loads.
  const pathname = useLocation({select: (location) => location.pathname});
  // Home only matches itself; every other item covers its subtree.
  return (item: NavItem) =>
    item.match === '/'
      ? pathname === '/'
      : pathname === item.match || pathname.startsWith(`${item.match}/`);
}

/** Primary destinations inline in the header, from tablet width up. */
export function AppTopNav() {
  const isActive = useIsActive();

  return (
    <nav aria-label='Primary' className='flex items-center max-md:hidden'>
      {navItems.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex h-12 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              active &&
                'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary',
            )}
          >
            <item.icon className='size-4' aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone navigation: every destination one tap away, with the current one always visible. */
export function AppTabBar() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label='Primary'
      data-testid='app-tab-bar'
      className='fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden'
    >
      <ul className='grid auto-cols-fr grid-flow-col'>
        {tabItems.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.label} className='min-w-0'>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-14 flex-col items-center justify-center gap-1 px-1 text-caption text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  active &&
                    'font-semibold text-primary before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:bg-primary',
                )}
              >
                <item.icon className='size-5' aria-hidden strokeWidth={active ? 2.25 : 1.75} />
                <span className='max-w-full truncate'>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function initials(name: string, email: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (letters || email[0] || '?').toUpperCase();
}

/** Account identity and session actions. */
export function AccountMenu() {
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const {logOut, isPending} = useLogOut();
  if (!currentAccount) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className='flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:ring-2 data-[state=open]:ring-border'
        aria-label={`Account menu, ${currentAccount.name} (${currentAccount.email})`}
        data-testid='account-menu-trigger'
      >
        <span aria-hidden>{initials(currentAccount.name, currentAccount.email)}</span>
        {/* Test hooks for the signed-in identity; the trigger's aria-label names it. */}
        <span className='sr-only' aria-hidden data-testid='current-account-name'>
          {currentAccount.name}
        </span>
        <span className='sr-only' aria-hidden data-testid='current-account-email'>
          {currentAccount.email}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={8} className='w-60 max-w-[calc(100vw-2rem)]'>
        <DropdownMenuLabel className='grid font-normal'>
          <span className='truncate text-sm font-semibold'>{currentAccount.name}</span>
          <span className='truncate text-xs text-muted-foreground'>{currentAccount.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to='/settings/account' className='cursor-pointer max-md:min-h-11'>
            <Settings className='mr-2 size-4' />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => logOut()}
          disabled={isPending}
          className='cursor-pointer max-md:min-h-11'
          data-testid='log-out-button'
        >
          <LogOut className='mr-2 size-4' />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
