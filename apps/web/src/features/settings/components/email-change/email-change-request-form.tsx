import {Loader} from 'lucide-react';
import {UseFormReturn} from 'react-hook-form';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {DialogClose, DialogFooter} from '@/components/ui/dialog';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {useChangeEmailRequest} from '../../api/use-change-email-request';
import {EmailChangeDto} from '../../types/email-change.dto';

type EmailChangeRequestFormProps = {
  form: UseFormReturn<EmailChangeDto>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStep: React.Dispatch<React.SetStateAction<'check' | 'request'>>;
};

export function EmailChangeRequestForm({form, setIsOpen, setStep}: EmailChangeRequestFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {changeEmailRequest, isPending} = useChangeEmailRequest();

  async function handleClick() {
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

  return (
    <div className={cn(!isDesktop && 'px-4')}>
      <div className='mt-4 flex w-full gap-4'>
        {isDesktop && (
          <DialogFooter className='w-full'>
            <DialogClose asChild>
              <Button variant='outline' type='button'>
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        )}
        <Button onClick={handleClick} disabled={isPending} className={cn(!isDesktop && 'w-full')}>
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
