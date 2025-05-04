import {zodResolver} from '@hookform/resolvers/zod';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {useMediaQuery} from '@/hooks/use-media-query';
import {Account} from '@/types/account';

import {EmailChangeDto, emailChangeDtoSchema} from '../../types/email-change.dto';
import {EmailChangeCheckForm} from './email-change-check-form';
import {EmailChangeRequestForm} from './email-change-request-form';

type EmailChangeDialogProps = {
  currentEmail: Account['email'];
};

export function EmailChangeDialog({currentEmail}: EmailChangeDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'check' | 'request'>('check');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const form = useForm<EmailChangeDto>({
    resolver: zodResolver(emailChangeDtoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const triggerButton = <Button variant='ghost'>Change</Button>;

  const formContent =
    step === 'check' ? (
      <EmailChangeCheckForm form={form} currentEmail={currentEmail} setStep={setStep} />
    ) : (
      <EmailChangeRequestForm form={form} setIsOpen={setIsOpen} setStep={setStep} />
    );

  const headerContent = {
    title: 'Change email',
    description:
      step === 'check' ? (
        <>
          <p className='mb-3'>
            To change your account email, we&apos;ll send a verification link to the new address.
          </p>
          <p className='mb-3'>
            Please check if the new email is tied to an existing account before proceeding with the
            change.
          </p>
        </>
      ) : (
        <>
          <p className='mb-3'>
            We did not find an existing account for{' '}
            <span className='text-foreground'>{form.getValues('newEmail')}</span>.
          </p>
          <p>You can safely proceed with the email change.</p>
        </>
      ),
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setStep('check');
      form.reset();
    }
  };

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{triggerButton}</DialogTrigger>
        <DialogContent aria-describedby='Change email' className='max-w-fit'>
          <DialogHeader className='w-[26rem]'>
            <DialogTitle className='mb-1'>{headerContent.title}</DialogTitle>
            <DialogDescription className='pt-2'>{headerContent.description}</DialogDescription>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
      <DrawerContent aria-describedby='Change email'>
        <DrawerHeader className='text-left'>
          <DrawerTitle className='mb-1'>{headerContent.title}</DrawerTitle>
          <DrawerDescription className='pt-2'>{headerContent.description}</DrawerDescription>
        </DrawerHeader>
        {formContent}
        <DrawerFooter className='pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
