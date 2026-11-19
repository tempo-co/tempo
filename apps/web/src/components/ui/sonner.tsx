import {CircleAlert, CircleCheck, Info, Loader, TriangleAlert} from 'lucide-react';
import {useTheme} from 'next-themes';
import {Toaster as Sonner} from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Sized like a small Button, with its 44px target on phones and coarse pointers.
const TOAST_BUTTON = 'h-9! rounded-md! px-3! text-sm! max-sm:min-h-11 pointer-coarse:min-h-11';

const Toaster = ({...props}: ToasterProps) => {
  const {theme = 'system'} = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      // A modal dialog makes the rest of the page inert; a toast's Undo must still work over it.
      className='toaster group pointer-events-auto'
      // Sonner's own variables; inline so they outrank its injected [data-sonner-toaster] defaults.
      style={
        {
          '--border-radius': 'var(--radius-card)',
          fontFamily: 'var(--font-sans)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Utilities are layered in Tailwind v4, so sonner's injected (unlayered) defaults win unless
          // these are !important; type-specific classes add data-[type] so they outrank the base toast.
          toast:
            'group toast group-[.toaster]:bg-background! group-[.toaster]:text-foreground! group-[.toaster]:border-border! group-[.toaster]:shadow-lg! text-sm!',
          description: 'group-[.toast]:text-muted-foreground!',
          // An outlined action in the toast's own colour fits every tint; a primary fill clashes on green.
          actionButton: `${TOAST_BUTTON} group-[.toast]:bg-transparent! group-[.toast]:text-current! group-[.toast]:border! group-[.toast]:border-current/40! hover:group-[.toast]:bg-current/10!`,
          cancelButton: `${TOAST_BUTTON} group-[.toast]:bg-muted! group-[.toast]:text-foreground!`,
          icon: 'group-data-[type=error]:text-destructive dark:group-data-[type=error]:text-foreground group-data-[type=success]:text-success dark:group-data-[type=success]:text-foreground group-data-[type=warning]:text-warning dark:group-data-[type=warning]:text-foreground group-data-[type=info]:text-info dark:group-data-[type=info]:text-foreground',
          error:
            'group-[.toaster]:data-[type=error]:bg-destructive-foreground! group-[.toaster]:data-[type=error]:text-destructive! dark:group-[.toaster]:data-[type=error]:text-foreground!',
          warning:
            'group-[.toaster]:data-[type=warning]:bg-warning-foreground! group-[.toaster]:data-[type=warning]:text-warning! dark:group-[.toaster]:data-[type=warning]:text-foreground!',
          info: 'group-[.toaster]:data-[type=info]:bg-info-foreground! group-[.toaster]:data-[type=info]:text-info! dark:group-[.toaster]:data-[type=info]:text-foreground!',
          success:
            'group-[.toaster]:data-[type=success]:bg-success-foreground! group-[.toaster]:data-[type=success]:text-success! dark:group-[.toaster]:data-[type=success]:text-foreground!',
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
