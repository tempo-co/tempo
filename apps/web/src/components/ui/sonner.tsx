import {CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert} from 'lucide-react';
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
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-semibold',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          icon: 'group-data-[type=error]:text-destructive dark:group-data-[type=error]:text-foreground group-data-[type=success]:text-success dark:group-data-[type=success]:text-foreground group-data-[type=warning]:text-warning dark:group-data-[type=warning]:text-foreground group-data-[type=info]:text-info dark:group-data-[type=info]:text-foreground',
          error:
            'group toast group-[.toaster]:bg-destructive-foreground group-[.toaster]:!text-destructive dark:group-[.toaster]:!text-foreground group-[.toaster]:shadow-lg',
          warning:
            'group toast group-[.toaster]:bg-warning-foreground group-[.toaster]:text-warning dark:group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
          info: 'group toast group-[.toaster]:bg-info-foreground group-[.toaster]:text-info dark:group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
          success:
            'group toast group-[.toaster]:bg-success-foreground group-[.toaster]:text-success dark:group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
        },
      }}
      icons={{
        success: <CircleCheck className='w-5' />,
        info: <Info className='w-5' />,
        warning: <TriangleAlert className='w-5' />,
        error: <CircleAlert className='w-5' />,
        loading: <LoaderCircle className='w-5' />,
      }}
      {...props}
    />
  );
};

export {Toaster};
