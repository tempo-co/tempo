import {zodResolver} from '@hookform/resolvers/zod';
import {REGEXP_ONLY_DIGITS} from 'input-otp';
import {Loader} from 'lucide-react';
import {useEffect} from 'react';
import {useForm} from 'react-hook-form';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {InputOTP, InputOTPGroup, InputOTPSlot} from '@/components/ui/input-otp';
import {EmailVerifyDto, emailVerifyDtoSchema} from '@/features/auth/types/email-verify.dto';

import {useChangeEmailRequest} from '../api/use-change-email-request';
import {useChangeEmailVerify} from '../api/use-change-email-verify';
import {EmailChangeDto} from '../types/email-change.dto';

type EmailChangeVerifyFormProps = {
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  emailChangeFormData: EmailChangeDto;
  resendCooldown: number;
  setResendCooldown: React.Dispatch<React.SetStateAction<number>>;
  resetAfterSuccess: () => void;
};

export function EmailChangeVerifyForm({
  setOpen,
  emailChangeFormData,
  resendCooldown,
  setResendCooldown,
  resetAfterSuccess,
}: EmailChangeVerifyFormProps) {
  const {changeEmailVerify, isPending: isVerifying} = useChangeEmailVerify();
  const {changeEmailRequest, isPending: isRequesting} = useChangeEmailRequest();

  const form = useForm<EmailVerifyDto>({
    resolver: zodResolver(emailVerifyDtoSchema),
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldown, setResendCooldown]);

  async function onSubmit(formData: EmailVerifyDto) {
    await changeEmailVerify(formData, {
      onError: (error) => {
        if (error.status === 400) {
          form.setError(
            'code',
            {message: 'This code is invalid or has expired.'},
            {shouldFocus: true},
          );
        }
      },
      onSuccess: () => {
        form.reset();
        resetAfterSuccess();
        setOpen(false);
      },
    });
  }

  async function handleResendCode() {
    await changeEmailRequest(emailChangeFormData, {
      onError: (error) => {
        if (error.status === 401) {
          toast.error('Authentication error', {
            description: 'Please try again with the correct password.',
          });
        }
        if (error.status === 409) {
          toast.error('This email is already in use', {
            description: 'Please try a different email.',
          });
        }
      },
      onSuccess: () => {
        toast.success('New verification code sent', {
          description: 'Please check your new email.',
        });
        form.reset();
        setResendCooldown(60);
      },
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          control={form.control}
          name='code'
          render={({field}) => (
            <FormItem className='flex flex-col items-center justify-center md:items-start'>
              <FormControl>
                <InputOTP
                  maxLength={6}
                  {...field}
                  value={String(field.value || '')}
                  pattern={REGEXP_ONLY_DIGITS}
                  disabled={isVerifying}
                >
                  <InputOTPGroup className='gap-3'>
                    <InputOTPSlot index={0} className='rounded-md' />
                    <InputOTPSlot index={1} className='rounded-md border-l' />
                    <InputOTPSlot index={2} className='rounded-md border-l' />
                    <InputOTPSlot index={3} className='rounded-md border-l' />
                    <InputOTPSlot index={4} className='rounded-md border-l' />
                    <InputOTPSlot index={5} className='rounded-md border-l' />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='flex flex-col gap-4'>
          <Button type='submit' disabled={isVerifying} className='mt-8 w-full'>
            {isVerifying ? (
              <>
                <span>Verifying...</span>
                <Loader className='h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Verify</span>
            )}
          </Button>
          <Button
            type='button'
            onClick={handleResendCode}
            disabled={isRequesting || resendCooldown > 0}
            className='mb-4 w-full md:mb-0'
            variant='ghost'
          >
            {isRequesting ? (
              <>
                <span>Sending new code...</span>
                <Loader className='h-4 w-4 animate-slow-spin' />
              </>
            ) : resendCooldown > 0 ? (
              <span>Resend code in {resendCooldown}s</span>
            ) : (
              <span>Send new code</span>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
