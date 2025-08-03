import * as React from 'react';

import {Drawer, DrawerContent, DrawerTrigger} from '@/components/ui/drawer';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useMediaQuery} from '@/hooks/use-media-query';

interface ResponsivePickerContextValue {
  isDesktop: boolean;
}

const ResponsivePickerContext = React.createContext<ResponsivePickerContextValue | null>(null);

const useResponsivePickerContext = () => {
  const context = React.useContext(ResponsivePickerContext);
  if (!context) {
    throw new Error('useResponsivePickerContext must be used within a ResponsivePickerProvider');
  }
  return context;
};

interface ResponsivePickerProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
}

const ResponsivePicker = ({children, modal = false, ...props}: ResponsivePickerProps) => {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const Picker = isDesktop ? Popover : Drawer;

  return (
    <ResponsivePickerContext.Provider value={{isDesktop}}>
      <Picker {...props} {...(isDesktop && {modal})}>
        {children}
      </Picker>
    </ResponsivePickerContext.Provider>
  );
};

const ResponsivePickerTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverTrigger>,
  React.ComponentPropsWithoutRef<typeof PopoverTrigger>
>(({children, ...props}, ref) => {
  const {isDesktop} = useResponsivePickerContext();
  const Trigger = isDesktop ? PopoverTrigger : DrawerTrigger;
  return (
    <Trigger {...props} ref={ref}>
      {children}
    </Trigger>
  );
});
ResponsivePickerTrigger.displayName = 'ResponsivePickerTrigger';

const ResponsivePickerContent = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  React.ComponentPropsWithoutRef<typeof PopoverContent>
>(({children, ...props}, ref) => {
  const {isDesktop} = useResponsivePickerContext();
  const Content = isDesktop ? PopoverContent : DrawerContent;
  return (
    <Content {...props} ref={ref}>
      {children}
    </Content>
  );
});
ResponsivePickerContent.displayName = 'ResponsivePickerContent';

export {ResponsivePicker, ResponsivePickerTrigger, ResponsivePickerContent};
