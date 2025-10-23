import {Separator} from '@/components/ui/separator';
import {SidebarTrigger} from '@/components/ui/sidebar';

type AppHeaderLayoutProps = {
  children: React.ReactNode;
};

export function AppHeaderLayout({children}: AppHeaderLayoutProps) {
  return (
    <header className='sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-2'>
      <SidebarTrigger />
      <Separator orientation='vertical' className='h-4' />
      {children}
    </header>
  );
}
