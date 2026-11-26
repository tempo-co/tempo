import {CircleAlert, CircleCheck, Info, Loader, TriangleAlert} from 'lucide-react';
import {Toaster as Sonner} from 'sonner';

import {useTheme} from '@/hooks/use-theme';

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Sized like a small Button, with its 44px target on phones and coarse pointers.
const TOAST_BUTTON =
  'h-8! rounded-md! px-3! text-body-small! max-sm:min-h-11 pointer-coarse:min-h-11';

const Toaster = ({...props}: ToasterProps) => {
  // The in-app choice; 'system' lets Sonner follow the device, as the app does.
  const {theme} = useTheme();

  return (
    <Sonner
      theme={theme}
      // A modal dialog makes the rest of the page inert; a toast's Undo must still work over it.
      className='toaster group pointer-events-auto'
      // Sonner's own variables; inline so they outrank its injected [data-sonner-toaster] defaults.
      style={
        {
          '--border-radius': 'var(--radius-lg)',
          fontFamily: 'var(--font-sans)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Utilities are layered in Tailwind v4, so sonner's injected (unlayered) defaults win unless
          // these are !important; type-specific classes add data-[type] so they outrank the base toast.
          toast:
            'group toast group-[.toaster]:bg-popover! group-[.toaster]:text-popover-foreground! group-[.toaster]:border-border! group-[.toaster]:shadow-lg! text-body!',
          description: 'group-[.toast]:text-muted-foreground!',
          // An outlined action in the toast's own colour fits every tint; a primary fill clashes on green.
          actionButton: `${TOAST_BUTTON} group-[.toast]:bg-transparent! group-[.toast]:text-current! group-[.toast]:border! group-[.toast]:border-current/40! hover:group-[.toast]:bg-current/10!`,
          cancelButton: `${TOAST_BUTTON} group-[.toast]:bg-muted! group-[.toast]:text-foreground!`,
          icon: 'group-data-[type=error]:text-destructive group-data-[type=success]:text-success group-data-[type=warning]:text-warning group-data-[type=info]:text-info',
          error:
            'group-[.toaster]:data-[type=error]:bg-destructive-muted! group-[.toaster]:data-[type=error]:text-destructive!',
          warning:
            'group-[.toaster]:data-[type=warning]:bg-warning-muted! group-[.toaster]:data-[type=warning]:text-warning!',
          info: 'group-[.toaster]:data-[type=info]:bg-info-muted! group-[.toaster]:data-[type=info]:text-info!',
          success:
            'group-[.toaster]:data-[type=success]:bg-success-muted! group-[.toaster]:data-[type=success]:text-success!',
        },
      }}
      icons={{
        success: <CircleCheck className='w-5' />,
        info: <Info className='w-5' />,
        warning: <TriangleAlert className='w-5' />,
        error: <CircleAlert className='w-5' />,
        loading: <Loader className='w-5 animate-slow-spin' />,
      }}
      {...props}
    />
  );
};

export {Toaster};
