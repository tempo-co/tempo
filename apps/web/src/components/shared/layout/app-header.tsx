import {AccountMenu, AppTopNav} from '@/components/shared/layout/app-nav';
import {LogoLink} from '@/components/shared/layout/logo-link';
import {OfflineStatus} from '@/components/shared/offline-status';

export function AppHeader() {
  return (
    <header className='sticky top-0 z-10 border-b bg-background'>
      <div className='mx-auto flex h-12 max-w-7xl items-center gap-4 px-4'>
        <LogoLink className='shrink-0 [&_svg]:size-7' />
        <AppTopNav />
        <div className='ml-auto flex min-w-0 items-center gap-3'>
          <OfflineStatus />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
