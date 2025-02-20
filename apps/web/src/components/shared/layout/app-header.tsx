import {Separator} from '@/components/ui/separator';
import {SidebarTrigger} from '@/components/ui/sidebar';

type AppHeaderProps = {
  children: React.ReactNode;
};

export function AppHeader({children}: AppHeaderProps) {
  return (
    <header className='flex items-center gap-2 border-b p-2'>
      <SidebarTrigger />
      <Separator orientation='vertical' className='h-4' />
      {children}
    </header>
  );
}
