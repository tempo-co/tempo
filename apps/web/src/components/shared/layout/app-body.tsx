import {cn} from '@/utils/cn';

type AppBodyLayoutProps = {
  children: React.ReactNode;
  className?: string;
};

export function AppBodyLayout({children, className}: AppBodyLayoutProps) {
  return <div className={cn('mx-auto my-8 max-w-[80rem] px-4', className)}>{children}</div>;
}
