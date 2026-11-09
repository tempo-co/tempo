import {AccountMenu, AppTopNav} from '@/components/shared/layout/app-nav';
import {LogoLink} from '@/components/shared/layout/logo-link';
import {OfflineStatus} from '@/components/shared/offline-status';

export function AppHeader() {
  return (
    <header className='sticky top-0 z-10 border-b bg-background'>
      <div className='mx-auto flex h-12 max-w-7xl items-center gap-4 px-4'>
        {/* A 44px tap target around the 36px mark; the negative margin keeps the row's spacing. */}
        <LogoLink className='-m-1 shrink-0 p-1 [&_svg]:size-9' />
        <AppTopNav />
        <div className='ml-auto flex min-w-0 items-center gap-3'>
          <OfflineStatus />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
