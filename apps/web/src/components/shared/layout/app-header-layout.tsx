import {Separator} from '@/components/ui/separator';
import {SidebarTrigger} from '@/components/ui/sidebar';

type AppHeaderLayoutProps = {
  children: React.ReactNode;
};

export function AppHeaderLayout({children}: AppHeaderLayoutProps) {
  return (
    <header className='flex items-center gap-2 border-b p-2'>
      <SidebarTrigger />
      <Separator orientation='vertical' className='h-4' />
      {children}
    </header>
  );
}
