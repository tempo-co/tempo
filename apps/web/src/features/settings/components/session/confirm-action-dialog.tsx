import {Loader} from 'lucide-react';
import {ReactNode, useState} from 'react';

import {Button, ButtonProps} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {cn} from '@/utils/cn';

type ConfirmActionDialogProps = {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  confirmTestId: string;
  confirmVariant?: ButtonProps['variant'];
  contentClassName?: string;
  isPending: boolean;
  onConfirm: () => Promise<unknown>;
};

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmTestId,
  confirmVariant,
  contentClassName = 'md:max-w-[30rem]',
  isPending,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleConfirm = async () => {
    await onConfirm();
    setIsOpen(false);
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>{trigger}</ResponsiveDialogTrigger>
      <ResponsiveDialogContent className={contentClassName}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className='flex gap-4'>
          <Button
            type='submit'
            disabled={isPending}
            className={cn(
              'order-1 md:order-2',
              confirmVariant === 'destructive' && 'text-foreground',
            )}
            variant={confirmVariant}
            onClick={handleConfirm}
            data-testid={confirmTestId}
          >
            {isPending ? (
              <>
                <span>{pendingLabel}</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </Button>
          <ResponsiveDialogClose asChild className='order-2 md:order-1'>
            <Button variant='outline' type='button'>
              Cancel
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
