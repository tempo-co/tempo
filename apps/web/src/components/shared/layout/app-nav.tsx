import {Link, useLocation} from '@tanstack/react-router';
import {
  ChartColumn,
  House,
  Landmark,
  Plus,
  ReceiptText,
  Repeat,
  Settings,
  Target,
} from 'lucide-react';

import Logo from '@/assets/logo';
import {OfflineStatus} from '@/components/shared/offline-status';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {useAddData} from '@/features/add-data/use-add-data';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {
  getAutomaticSyncProblemForConnection,
  isConsentEndingSoon,
} from '@/features/banking/utils/bank-sync-status';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {cn} from '@/utils/cn';

type NavItem = {
  label: string;
  to: '/' | '/transactions' | '/insights' | '/recurring' | '/accounts';
  icon: typeof House;
  /** Recurring opens from Home and Insights on phones, so it has no tab. */
  tab: boolean;
};

const navItems: NavItem[] = [
  {label: 'Home', to: '/', icon: House, tab: true},
  {label: 'Transactions', to: '/transactions', icon: ReceiptText, tab: true},
  {label: 'Insights', to: '/insights', icon: ChartColumn, tab: true},
  {label: 'Recurring', to: '/recurring', icon: Repeat, tab: false},
  {label: 'Accounts', to: '/accounts', icon: Landmark, tab: true},
];

const SETTINGS = '/settings';

type NavBadge = {count: number | null; label: string};

/**
 * What needs the owner sits on the page that settles it: transactions to review as a count on Transactions, a bank
 * whose automatic sync needs attention, or whose consent ends within a week, as a dot on Accounts.
 */
function useNavBadges() {
  const {reviewCounts} = useGetBankTransactionReviewCounts();
  const {bankConnections} = useGetAllBankConnections();
  // One row can be in several review groups, so the badge counts what needs the owner once per row.
  const review = reviewCounts?.needsAttention ?? 0;
  const connections = bankConnections ?? [];
  const problems = connections.filter(getAutomaticSyncProblemForConnection).length;
  const endingSoon = connections.filter(isConsentEndingSoon).length;
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
    if (item.to === '/transactions' && review > 0)
      return {count: review, label: `${review} to review`};
    if (item.to === '/accounts' && banksLabel) return {count: null, label: banksLabel};
    return null;
  };
}

function Badge({badge, className}: {badge: NavBadge; className?: string}) {
  return badge.count === null ? (
    <i aria-hidden='true' className={cn('size-2 shrink-0 rounded-full bg-warning', className)} />
  ) : (
    <span
      aria-hidden='true'
      className={cn(
        'grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full bg-primary px-1 numeric text-caption font-semibold text-primary-foreground',
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
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The logo, linking Home. */
function HomeLink({className}: {className?: string}) {
  return (
    <Link
      to='/'
      aria-label='Tempo home'
      className={cn(
        'press-feedback grid size-9 shrink-0 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <Logo className='size-7' />
    </Link>
  );
}

/** A label that names its item while the sidebar is open and stays readable to assistive technology when collapsed. */
const LABEL = 'min-w-0 truncate group-data-[collapsible=icon]:sr-only';

/** Desktop navigation, from `md` up: Add data, the pages, Plan for later, and who is signed in with Settings. */
export function AppSidebar() {
  const {openMenu: addData} = useAddData();
  const isActive = useIsActive();
  const badgeOf = useNavBadges();
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const settingsActive = useLocation({
    select: (location) => location.pathname.startsWith('/settings'),
  });

  return (
    <Sidebar data-testid='app-sidebar'>
      <SidebarHeader className='gap-3'>
        <div className='flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col'>
          <HomeLink />
          <SidebarTrigger />
        </div>
        <button
          type='button'
          onClick={addData}
          className='flex h-8 items-center gap-2 rounded-md bg-primary px-2.5 text-body-small font-medium text-primary-foreground transition-colors group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:px-0 hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 [&_svg]:size-4 [&_svg]:shrink-0'
        >
          <Plus aria-hidden='true' />
          <span className={LABEL}>Add data</span>
        </button>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label='Primary'>
          <SidebarMenu>
            {navItems.map((item) => {
              const active = isActive(item);
              const badge = badgeOf(item);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      aria-label={badge ? `${item.label}, ${badge.label}` : undefined}
                    >
                      <span className='relative grid shrink-0 place-items-center'>
                        <item.icon className='size-4' aria-hidden='true' />
                        {badge && (
                          <span
                            aria-hidden='true'
                            className={cn(
                              'absolute -top-1 -right-1 hidden size-2 rounded-full group-data-[collapsible=icon]:block',
                              badge.count === null ? 'bg-warning' : 'bg-primary',
                            )}
                          />
                        )}
                      </span>
                      <span className={LABEL}>{item.label}</span>
                      {badge && (
                        <Badge
                          badge={badge}
                          className='ml-auto group-data-[collapsible=icon]:hidden'
                        />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            <SidebarMenuItem>
              {/* Plan is announced, not built: shown for later and not reachable. */}
              <SidebarMenuButton asChild aria-disabled='true' className='opacity-60'>
                <span>
                  <Target className='size-4' aria-hidden='true' />
                  <span className={LABEL}>Plan</span>
                  <span className='ml-auto text-label text-faint group-data-[collapsible=icon]:hidden'>
                    later
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div className='flex items-center gap-2 group-data-[collapsible=icon]:justify-center'>
          {currentAccount && (
            <div className='grid min-w-0 flex-1 pl-0.5 group-data-[collapsible=icon]:hidden'>
              <span
                className='truncate text-body-small font-medium'
                data-testid='current-account-name'
                title={currentAccount.name}
              >
                {currentAccount.name}
              </span>
              <span
                className='truncate text-body-small text-muted-foreground'
                data-testid='current-account-email'
                title={currentAccount.email}
              >
                {currentAccount.email}
              </span>
            </div>
          )}
          <SidebarMenuButton
            asChild
            isActive={settingsActive}
            tooltip='Settings'
            className='size-9 shrink-0 justify-center px-0'
          >
            <Link
              to={SETTINGS}
              aria-label='Settings'
              aria-current={settingsActive ? 'page' : undefined}
            >
              <Settings aria-hidden='true' />
            </Link>
          </SidebarMenuButton>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

const HEADER_ACTION =
  'grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_svg]:size-5';

/** The phone header: the logo, then Add data and Settings, which have no tab. */
export function AppPhoneHeader() {
  const {openMenu: addData} = useAddData();
  return (
    <header
      data-testid='app-phone-header'
      className='sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background pr-1 pl-2 md:hidden'
    >
      <HomeLink className='size-11' />
      <div className='ml-auto flex min-w-0 items-center'>
        <OfflineStatus />
        <button type='button' onClick={addData} aria-label='Add data' className={HEADER_ACTION}>
          <Plus aria-hidden='true' />
        </button>
        <Link to={SETTINGS} aria-label='Settings' className={HEADER_ACTION}>
          <Settings aria-hidden='true' />
        </Link>
      </div>
    </header>
  );
}

/** Phone navigation: four tabs, with the current one always visible. */
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
        {navItems
          .filter((item) => item.tab)
          .map((item) => {
            const active = isActive(item);
            const badge = badgeOf(item);
            return (
              <li key={item.to} className='min-w-0'>
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
