import {CircleAlert} from 'lucide-react';
import {ReactNode, useRef, useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Button, ButtonProps} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {wasToasted} from '@/utils/api';

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
  /**
   * Reports a rejected `onConfirm`: in the dialog while it is open, as a toast once it has closed.
   * Callers whose `onConfirm` resolves and reports its own outcome leave it out.
   */
  failureMessage?: string;
};

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmTestId,
  confirmVariant,
  contentClassName = 'md:max-w-120',
  isPending,
  onConfirm,
  failureMessage,
}: ConfirmActionDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const openRef = useRef(false);

  const changeOpen = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setIsOpen(nextOpen);
    if (nextOpen) setFailed(false);
  };

  const handleConfirm = async () => {
    setFailed(false);
    try {
      await onConfirm();
      changeOpen(false);
    } catch (error) {
      if (!failureMessage || wasToasted(error)) return;
      if (openRef.current) setFailed(true);
      else toast.error(failureMessage);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={changeOpen}>
      <ResponsiveDialogTrigger asChild>{trigger}</ResponsiveDialogTrigger>
      <ResponsiveDialogContent className={contentClassName}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {failed && (
          <ResponsiveDialogBody>
            <Alert role='alert' variant='destructive'>
              <CircleAlert aria-hidden='true' />
              <AlertDescription className='text-foreground'>{failureMessage}</AlertDescription>
            </Alert>
          </ResponsiveDialogBody>
        )}
        <ResponsiveDialogFooter className='flex gap-4'>
          <Button
            type='submit'
            disabled={isPending}
            className='order-1 md:order-2'
            variant={confirmVariant}
            onClick={handleConfirm}
            data-testid={confirmTestId}
          >
            {isPending ? <PendingLabel>{pendingLabel}</PendingLabel> : <span>{confirmLabel}</span>}
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
