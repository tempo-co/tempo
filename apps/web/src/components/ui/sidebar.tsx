/* eslint-disable react-refresh/only-export-components */
import {Slot} from '@radix-ui/react-slot';
import {PanelLeft} from 'lucide-react';
import * as React from 'react';

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

const SIDEBAR_STORAGE_KEY = 'wisp-sidebar-collapsed';
const SIDEBAR_WIDTH = '15rem';
const SIDEBAR_WIDTH_ICON = '3.5rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  /** Whether there is room to expand it; narrower windows keep it collapsed. */
  wide: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }

  return context;
}

/** Below this width the page needs the room, so the sidebar shows only its icons. */
const SIDEBAR_WIDE_QUERY = '(min-width: 1024px)';

const subscribeWide = (onChange: () => void) => {
  const query = matchMedia(SIDEBAR_WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isWide = () => matchMedia(SIDEBAR_WIDE_QUERY).matches;

/** Whether this device last left the sidebar collapsed. Storage can be unavailable, so it falls back to open. */
function readOpen() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

function saveOpen(open: boolean) {
  try {
    if (open) window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    else window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
  } catch {
    /* The choice holds for this visit only. */
  }
}

/** The desktop sidebar's state. Collapsed or expanded is remembered per device. */
const SidebarProvider = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, style, children, ...props}, ref) => {
    const [chosen, setOpenState] = React.useState(readOpen);
    const wide = React.useSyncExternalStore(subscribeWide, isWide);
    const open = chosen && wide;
    const setOpen = React.useCallback((value: boolean) => {
      setOpenState(value);
      saveOpen(value);
    }, []);
    const toggleSidebar = React.useCallback(() => {
      if (wide) setOpen(!open);
    }, [wide, open, setOpen]);

    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (wide && event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          toggleSidebar();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [wide, toggleSidebar]);

    const state = open ? 'expanded' : 'collapsed';
    const contextValue = React.useMemo<SidebarContextProps>(
      () => ({state, open, wide, setOpen, toggleSidebar}),
      [state, open, wide, setOpen, toggleSidebar],
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <div
            style={
              {
                '--sidebar-width': SIDEBAR_WIDTH,
                '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
            ref={ref}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = 'SidebarProvider';

/** A left sidebar from `md` up that collapses to its icons. Below `md` it is not shown. */
const Sidebar = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, children, ...props}, ref) => {
    const {state} = useSidebar();

    return (
      <div
        ref={ref}
        className='group peer hidden text-sidebar-foreground md:block'
        data-state={state}
        data-collapsible={state === 'collapsed' ? 'icon' : ''}
      >
        {/* Holds the sidebar's width in the page's flow, under the fixed sidebar. */}
        <div className='relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-out group-data-[collapsible=icon]:w-(--sidebar-width-icon) motion-reduce:transition-none' />
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) border-r border-sidebar-border transition-[width] duration-200 ease-out group-data-[collapsible=icon]:w-(--sidebar-width-icon) motion-reduce:transition-none md:flex',
            className,
          )}
          {...props}
        >
          <div data-sidebar='sidebar' className='flex h-full w-full flex-col bg-sidebar'>
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = 'Sidebar';

const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({className, onClick, ...props}, ref) => {
  const {toggleSidebar, open, wide} = useSidebar();
  if (!wide) return null;

  return (
    <Button
      ref={ref}
      data-sidebar='trigger'
      variant='ghost'
      size='icon'
      aria-expanded={open}
      aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
      className={cn('text-muted-foreground', className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeft />
    </Button>
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, ...props}, ref) => {
    return (
      <div
        ref={ref}
        className={cn('relative flex w-full min-w-0 flex-1 flex-col bg-background', className)}
        {...props}
      />
    );
  },
);
SidebarInset.displayName = 'SidebarInset';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, ...props}, ref) => {
    return (
      <div
        ref={ref}
        data-sidebar='header'
        className={cn('flex flex-col gap-2 p-2', className)}
        {...props}
      />
    );
  },
);
SidebarHeader.displayName = 'SidebarHeader';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, ...props}, ref) => {
    return (
      <div
        ref={ref}
        data-sidebar='footer'
        className={cn('flex flex-col gap-2 border-t border-sidebar-border p-2', className)}
        {...props}
      />
    );
  },
);
SidebarFooter.displayName = 'SidebarFooter';

const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({className, ...props}, ref) => {
    return (
      <div
        ref={ref}
        data-sidebar='content'
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 group-data-[collapsible=icon]:overflow-hidden',
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarContent.displayName = 'SidebarContent';

const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({className, ...props}, ref) => (
    <ul
      ref={ref}
      data-sidebar='menu'
      className={cn('flex w-full min-w-0 flex-col gap-0.5', className)}
      {...props}
    />
  ),
);
SidebarMenu.displayName = 'SidebarMenu';

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({className, ...props}, ref) => (
    <li
      ref={ref}
      data-sidebar='menu-item'
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  ),
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

const SIDEBAR_MENU_BUTTON =
  'peer/menu-button flex h-8 w-full items-center gap-3 overflow-hidden rounded-md border border-transparent px-2.5 text-left text-body text-muted-foreground transition-colors hover:bg-sunk hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:pointer-events-none data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0';

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> & {
    asChild?: boolean;
    isActive?: boolean;
    /** Shown beside the icon while the sidebar is collapsed to its icons. */
    tooltip?: string;
  }
>(({asChild = false, isActive = false, tooltip, className, ...props}, ref) => {
  const Comp = asChild ? Slot : 'button';
  const {state} = useSidebar();

  const button = (
    <Comp
      ref={ref}
      data-sidebar='menu-button'
      data-active={isActive}
      className={cn(SIDEBAR_MENU_BUTTON, className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side='right' align='center' hidden={state !== 'collapsed'}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
});
SidebarMenuButton.displayName = 'SidebarMenuButton';

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
};
