import {zodResolver} from '@hookform/resolvers/zod';
import {PencilLine} from 'lucide-react';
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
import {User} from '@/types/user';
import {cn} from '@/utils/cn';

import {EmailChangeDto, emailChangeDtoSchema} from '../types/email-change.dto';
import {EmailChangeRequestForm} from './email-change-request-form';

type EmailChangeDialogProps = {
  currentEmail: User['email'];
};

export function EmailChangeDialog({currentEmail}: EmailChangeDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'change' | 'verify'>('change');
  const [resendCooldown, setResendCooldown] = useState(0);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const resetAfterSuccess = () => {
    form.reset();
    setStep('change');
    setResendCooldown(0);
  };

  const form = useForm<EmailChangeDto>({
    resolver: zodResolver(emailChangeDtoSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const triggerButton = (
    <Button variant='outline' className='w-full md:w-fit'>
      <PencilLine />
      Change email
    </Button>
  );

  const headerContent = {
    title: step === 'change' ? 'Change email' : 'Verify new email',
    description:
      step === 'change' ? (
        <>
          Your current email is <span className='text-foreground'>{currentEmail}</span>
        </>
      ) : (
        <>
          We&apos;ve sent a 6-digit verification code to{' '}
          <span className='text-foreground'>{currentEmail}</span>
        </>
      ),
  };

  const formContent = (
    <EmailChangeRequestForm
      form={form}
      setOpen={setOpen}
      step={step}
      setStep={setStep}
      resendCooldown={resendCooldown}
      setResendCooldown={setResendCooldown}
      resetAfterSuccess={resetAfterSuccess}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{triggerButton}</DialogTrigger>
        <DialogContent aria-describedby='Change email' className='max-w-fit'>
          <DialogHeader className={cn(step === 'change' ? 'w-[24rem]' : 'max-w-[18rem]')}>
            <DialogTitle className='mb-1'>{headerContent.title}</DialogTitle>
            <DialogDescription>{headerContent.description}</DialogDescription>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
      <DrawerContent aria-describedby='Change email'>
        <DrawerHeader className='text-left'>
          <DrawerTitle className='mb-1'>{headerContent.title}</DrawerTitle>
          <DrawerDescription>{headerContent.description}</DrawerDescription>
        </DrawerHeader>
        {formContent}
        {step === 'change' && (
          <DrawerFooter className='pt-4'>
            <DrawerClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
