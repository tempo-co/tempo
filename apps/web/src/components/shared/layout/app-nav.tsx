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
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {
  getAutomaticSyncProblemForConnection,
  isConsentEndingSoon,
} from '@/features/banking/utils/bank-sync-status';
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

type NavBadge = {count: number | null; label: string};

/**
 * What needs the owner sits on the tab that settles it: transactions to review as a count on Transactions, a bank
 * whose automatic sync needs attention, or whose consent ends within a week, as a dot on Connections.
 */
function useNavBadges() {
  const {reviewCounts} = useGetBankTransactionReviewCounts();
  const {bankConnections} = useGetAllBankConnections();
  const review = reviewCounts
    ? reviewCounts.needsReview + reviewCounts.categorizationFailed + reviewCounts.unknownDirection
    : 0;
  const connections = bankConnections ?? [];
  const problems = connections.filter(getAutomaticSyncProblemForConnection).length;
  const endingSoon = connections.filter((connection) => isConsentEndingSoon(connection)).length;
  const banksLabel = [
    problems === 0
      ? null
      : problems === 1
        ? 'a bank needs attention'
        : `${problems} banks need attention`,
    endingSoon === 0
      ? null
      : endingSoon === 1
        ? 'a bank needs re-authorizing soon'
        : `${endingSoon} banks need re-authorizing soon`,
  ]
    .filter(Boolean)
    .join(' and ');
  return (item: NavItem): NavBadge | null => {
    if (item.to === '/bank-transactions' && review > 0)
      return {count: review, label: `${review} to review`};
    if (item.to === '/bank-connections' && banksLabel) return {count: null, label: banksLabel};
    return null;
  };
}

function Badge({badge, className}: {badge: NavBadge; className?: string}) {
  return badge.count === null ? (
    <i aria-hidden='true' className={cn('size-2 rounded-full bg-warning', className)} />
  ) : (
    <span
      aria-hidden='true'
      className={cn(
        'grid h-[1.125rem] min-w-[1.125rem] place-items-center bg-primary px-1 numeric text-[0.6875rem] leading-none font-semibold text-primary-foreground',
        className,
      )}
    >
      {badge.count > 99 ? '99+' : badge.count}
    </span>
  );
}

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
  const badgeOf = useNavBadges();

  return (
    <nav aria-label='Primary' className='flex items-center max-md:hidden'>
      {navItems.map((item) => {
        const active = isActive(item);
        const badge = badgeOf(item);
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            aria-label={badge ? `${item.label}, ${badge.label}` : undefined}
            className={cn(
              'relative flex h-12 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              active &&
                'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary',
            )}
          >
            <item.icon className='size-4' aria-hidden />
            {item.label}
            {badge && <Badge badge={badge} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone navigation: every destination one tap away, with the current one always visible. */
export function AppTabBar() {
  const isActive = useIsActive();
  const badgeOf = useNavBadges();

  return (
    <nav
      aria-label='Primary'
      data-testid='app-tab-bar'
      className='fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden'
    >
      <ul className='grid auto-cols-fr grid-flow-col'>
        {tabItems.map((item) => {
          const active = isActive(item);
          const badge = badgeOf(item);
          return (
            <li key={item.label} className='min-w-0'>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                aria-label={badge ? `${item.label}, ${badge.label}` : undefined}
                className={cn(
                  'relative flex h-14 flex-col items-center justify-center gap-1 px-1 text-caption text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  active &&
                    'font-semibold text-primary before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:bg-primary',
                )}
              >
                <span className='relative'>
                  <item.icon className='size-5' aria-hidden strokeWidth={active ? 2.25 : 1.75} />
                  {badge && <Badge badge={badge} className='absolute -top-1.5 left-3' />}
                </span>
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
        className='flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-accent data-[state=open]:ring-2 data-[state=open]:ring-border max-sm:size-11 pointer-coarse:size-11'
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
