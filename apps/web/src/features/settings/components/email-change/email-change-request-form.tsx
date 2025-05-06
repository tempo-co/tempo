import {Loader} from 'lucide-react';
import {UseFormReturn} from 'react-hook-form';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';

import {useChangeEmailRequest} from '../../api/use-change-email-request';
import {EmailChangeDto} from '../../types/email-change.dto';

type EmailChangeRequestFormProps = {
  form: UseFormReturn<EmailChangeDto>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStep: React.Dispatch<React.SetStateAction<'check' | 'request'>>;
};

export function EmailChangeRequestForm({form, setIsOpen, setStep}: EmailChangeRequestFormProps) {
  const {changeEmailRequest, isPending} = useChangeEmailRequest();

  async function handleSendVerification() {
    const formData = form.getValues();
    await changeEmailRequest(formData, {
      onSuccess: () => {
        toast.success('Verification email sent.', {
          description: (
            <>
              We have sent a verification link to{' '}
              <span className='text-foreground'>{formData.newEmail}</span>.{' '}
              <p>Your email will be changed once you click this link.</p>
            </>
          ),
        });
        form.reset();
        setStep('check');
        setIsOpen(false);
      },
      onError: (error) => {
        if (error.status === 409) {
          toast.error('This email is already in use.', {
            description: 'Please try another email.',
          });
        } else {
          toast.error('Something went wrong', {
            description: 'Please try again.',
          });
        }
        form.reset();
        setStep('check');
        setIsOpen(false);
      },
    });
  }

  function handleBack() {
    setStep('check');
    form.resetField('newEmail');
  }

  return (
    <div>
      <div className='mt-4 flex w-full flex-col-reverse gap-4 md:flex-row md:justify-end'>
        <Button
          variant='outline'
          type='button'
          onClick={handleBack}
          disabled={isPending}
          className='mb-4 w-full md:mb-0 md:w-auto'
        >
          Back
        </Button>
        <Button onClick={handleSendVerification} disabled={isPending} className='w-full md:w-auto'>
          {isPending ? (
            <>
              <span>Sending...</span>
              <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Send verification code</span>
          )}
        </Button>
      </div>
    </div>
  );
}
