import * as React from 'react';

import {Drawer, DrawerContent, DrawerTrigger} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {Button} from './button';
import {Separator} from './separator';

interface BaseProps {
  children: React.ReactNode;
  className?: string;
}

interface RootResponsiveMenuProps extends BaseProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ResponsiveMenuContext = React.createContext<{isDesktop: boolean}>({
  isDesktop: false,
});

const useResponsiveMenu = () => {
  const context = React.useContext(ResponsiveMenuContext);
  if (!context) {
    throw new Error('useResponsiveMenu must be used within a ResponsiveMenu');
  }
  return context;
};

const ResponsiveMenu = ({children, ...props}: RootResponsiveMenuProps) => {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const Menu = isDesktop ? DropdownMenu : Drawer;

  return (
    <ResponsiveMenuContext.Provider value={{isDesktop}}>
      <Menu {...props}>{children}</Menu>
    </ResponsiveMenuContext.Provider>
  );
};

const ResponsiveMenuTrigger = ({
  className,
  children,
  ...props
}: BaseProps & {asChild?: boolean}) => {
  const {isDesktop} = useResponsiveMenu();
  const Trigger = isDesktop ? DropdownMenuTrigger : DrawerTrigger;

  return (
    <Trigger className={className} {...props}>
      {children}
    </Trigger>
  );
};

const ResponsiveMenuContent = ({className, children, ...props}: BaseProps) => {
  const {isDesktop} = useResponsiveMenu();
  const Content = isDesktop ? DropdownMenuContent : DrawerContent;

  return (
    <Content className={className} {...props}>
      {children}
    </Content>
  );
};

const ResponsiveMenuItem = ({
  className,
  children,
  ...props
}: BaseProps & {onClick?: () => void; disabled?: boolean}) => {
  const {isDesktop} = useResponsiveMenu();

  if (isDesktop) {
    return (
      <DropdownMenuItem className={cn('focus:cursor-pointer', className)} {...props}>
        {children}
      </DropdownMenuItem>
    );
  }

  return (
    <Button variant='ghost' className={cn('justify-start', className)} {...props}>
      {children}
    </Button>
  );
};

const ResponsiveMenuSeparator = ({className}: {className?: string}) => {
  const {isDesktop} = useResponsiveMenu();

  if (isDesktop) {
    return <DropdownMenuSeparator className={className} />;
  }

  return <Separator className={cn('mx-4 my-1 w-auto', className)} />;
};

export {
  ResponsiveMenu,
  ResponsiveMenuTrigger,
  ResponsiveMenuContent,
  ResponsiveMenuItem,
  ResponsiveMenuSeparator,
};
