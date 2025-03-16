import {zodResolver} from '@hookform/resolvers/zod';
import {REGEXP_ONLY_DIGITS} from 'input-otp';
import {Loader} from 'lucide-react';
import {useCallback, useEffect} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {InputOTP, InputOTPGroup, InputOTPSlot} from '@/components/ui/input-otp';

import {useResendVerificationEmail} from '../api/use-resend-verification-email';
import {useVerifyEmail} from '../api/use-verify-email';
import {EmailVerifyDto, emailVerifyDtoSchema} from '../types/email-verify.dto';

type VerifyFormProps = {
  code: string | undefined;
};

export function VerifyForm({code}: VerifyFormProps) {
  const {verifyEmail, isPending: isVerifying} = useVerifyEmail();
  const {resendVerificationEmail, isPending: isResending} = useResendVerificationEmail();

  const form = useForm<EmailVerifyDto>({
    resolver: zodResolver(emailVerifyDtoSchema),
    mode: 'onSubmit',
    defaultValues: {code: code || ''},
  });

  const handleVerifyEmail = useCallback(
    async (data: EmailVerifyDto) => {
      await verifyEmail(data, {
        onError: (error) => {
          if (error.status === 400) {
            form.setError(
              'code',
              {message: 'This code is invalid or has expired.'},
              {shouldFocus: true},
            );
          }
        },
      });
    },
    [verifyEmail, form],
  );

  useEffect(() => {
    const verifyEmailWithCode = async () => {
      if (code) {
        await handleVerifyEmail({code});
      }
    };
    void verifyEmailWithCode();
  }, [handleVerifyEmail, code]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleVerifyEmail)} noValidate>
        <FormField
          control={form.control}
          name='code'
          render={({field}) => (
            <FormItem className='flex flex-col justify-center'>
              <FormControl className='w-fit'>
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
        <Button
          type='submit'
          disabled={isVerifying || !form.formState.isValid}
          className='mt-4 w-full'
        >
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
          className='mt-4 w-full'
          type='button'
          variant='ghost'
          onClick={() => resendVerificationEmail()}
          disabled={isResending}
        >
          {isResending ? (
            <>
              <span>Sending new code...</span>
              <Loader className='h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Send new code</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
