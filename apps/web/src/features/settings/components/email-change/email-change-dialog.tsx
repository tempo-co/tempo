import {zodResolver} from '@hookform/resolvers/zod';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
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

  const form = useForm<EmailChangeDto>({
    resolver: zodResolver(emailChangeDtoSchema),
    mode: 'onSubmit',
  });

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setStep('check');
      form.reset();
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button variant='ghost' data-testid='change-email-button'>
          Change
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader className='text-start md:w-[26rem]'>
          <ResponsiveDialogTitle className='mb-1'>Change email</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='min-w-0 pt-2'>
            {step === 'check' ? (
              <>
                <p className='mb-3'>
                  To change your account&apos;s email, we will send a verification link to your new
                  address.
                </p>
                <p className='mb-3'>
                  Please check if the new email is tied to an existing account before proceeding
                  with the change.
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
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {step === 'check' ? (
            <EmailChangeCheckForm form={form} currentEmail={currentEmail} setStep={setStep} />
          ) : (
            <EmailChangeRequestForm form={form} setIsOpen={setIsOpen} setStep={setStep} />
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
