import {X} from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

interface BaseProps {
  children: React.ReactNode;
}

interface RootResponsiveDialogProps extends BaseProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ResponsiveDialogProps extends BaseProps {
  className?: string;
  asChild?: true;
  'aria-label'?: string;
  'data-testid'?: string;
}

const ResponsiveDialogContext = React.createContext<{isDesktop: boolean}>({
  isDesktop: false,
});

const useResponsiveDialogContext = () => {
  const context = React.useContext(ResponsiveDialogContext);
  if (!context) {
    throw new Error(
      'ResponsiveDialog components cannot be rendered outside the ResponsiveDialog Context',
    );
  }
  return context;
};

const ResponsiveDialog = ({children, ...props}: RootResponsiveDialogProps) => {
  const isDesktop = !useIsMobile();
  const ResponsiveDialog = isDesktop ? Dialog : Drawer;

  return (
    <ResponsiveDialogContext.Provider value={{isDesktop}}>
      <ResponsiveDialog {...props} {...(!isDesktop && {autoFocus: true})}>
        {children}
      </ResponsiveDialog>
    </ResponsiveDialogContext.Provider>
  );
};

const ResponsiveDialogTrigger = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogTrigger = isDesktop ? DialogTrigger : DrawerTrigger;

  return (
    <ResponsiveDialogTrigger className={className} {...props}>
      {children}
    </ResponsiveDialogTrigger>
  );
};

const ResponsiveDialogClose = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogClose = isDesktop ? DialogClose : DrawerClose;

  return (
    <ResponsiveDialogClose className={className} {...props}>
      {children}
    </ResponsiveDialogClose>
  );
};

/** A 44px close button in the top corner of a full-height sheet whose own close button is hidden. */
const ResponsiveDialogCornerClose = ({label}: {label: string}) => (
  <ResponsiveDialogClose
    aria-label={label}
    className='absolute top-3 right-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  >
    <X className='h-4 w-4' aria-hidden='true' />
    <span className='sr-only'>{label}</span>
  </ResponsiveDialogClose>
);

/** A toast's action (such as Undo) answers what happened in the dialog; it is not a click outside it. */
const keepOpenForToasts = (event: {target: EventTarget | null; preventDefault: () => void}) => {
  if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]'))
    event.preventDefault();
};

const ResponsiveDialogContent = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogContent = isDesktop ? DialogContent : DrawerContent;

  return (
    <ResponsiveDialogContent className={className} onInteractOutside={keepOpenForToasts} {...props}>
      {children}
    </ResponsiveDialogContent>
  );
};

const ResponsiveDialogDescription = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogDescription = isDesktop ? DialogDescription : DrawerDescription;

  return (
    <ResponsiveDialogDescription className={className} {...props}>
      {children}
    </ResponsiveDialogDescription>
  );
};

const ResponsiveDialogHeader = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogHeader = isDesktop ? DialogHeader : DrawerHeader;

  return (
    <ResponsiveDialogHeader className={className} {...props}>
      {children}
    </ResponsiveDialogHeader>
  );
};

const ResponsiveDialogTitle = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogTitle = isDesktop ? DialogTitle : DrawerTitle;

  return (
    <ResponsiveDialogTitle className={className} {...props}>
      {children}
    </ResponsiveDialogTitle>
  );
};

const ResponsiveDialogBody = ({className, children, ...props}: ResponsiveDialogProps) => {
  return (
    <div className={cn('px-4 md:px-0', className)} {...props}>
      {children}
    </div>
  );
};

const ResponsiveDialogFooter = ({className, children, ...props}: ResponsiveDialogProps) => {
  const {isDesktop} = useResponsiveDialogContext();
  const ResponsiveDialogFooter = isDesktop ? DialogFooter : DrawerFooter;

  return (
    <ResponsiveDialogFooter className={className} {...props}>
      {children}
    </ResponsiveDialogFooter>
  );
};

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
};
