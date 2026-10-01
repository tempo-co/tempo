import {CircleAlert, CircleCheck, Info, Loader, TriangleAlert} from 'lucide-react';
import {useTheme} from 'next-themes';
import {Toaster as Sonner} from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({...props}: ToasterProps) => {
  const {theme = 'system'} = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group'
      toastOptions={{
        classNames: {
          // Utilities are layered in Tailwind v4, so sonner's injected (unlayered) defaults win unless
          // these are !important; type-specific classes add data-[type] so they outrank the base toast.
          toast:
            'group toast group-[.toaster]:bg-background! group-[.toaster]:text-foreground! group-[.toaster]:border-border! group-[.toaster]:shadow-lg!',
          description: 'group-[.toast]:text-muted-foreground!',
          actionButton:
            'group-[.toast]:bg-primary! group-[.toast]:text-primary-foreground! font-semibold',
          cancelButton: 'group-[.toast]:bg-muted! group-[.toast]:text-muted-foreground!',
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
