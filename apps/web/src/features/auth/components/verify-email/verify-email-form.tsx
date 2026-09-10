import {zodResolver} from '@hookform/resolvers/zod';
import {REGEXP_ONLY_DIGITS} from 'input-otp';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {InputOTP, InputOTPGroup, InputOTPSlot} from '@/components/ui/input-otp';
import {useCurrentAccount} from '@/hooks/use-current-account';

import {useVerifyEmail} from '../../api/use-verify-email';
import {EmailVerifyDto, emailVerifyDtoSchema} from '../../types/email-verify.dto';

export function VerifyEmailForm() {
  const {verifyEmail, isPending: isVerifying} = useVerifyEmail();
  const {currentAccount} = useCurrentAccount({skipFetch: true});

  const form = useForm<EmailVerifyDto>({
    resolver: zodResolver(emailVerifyDtoSchema),
    mode: 'onChange',
    defaultValues: {email: currentAccount?.email},
  });

  async function onSubmit(data: EmailVerifyDto) {
    await verifyEmail(data, {
      onError: (error) => {
        if (error.status === 400) {
          form.setError('code', {message: 'This code is invalid or has expired.'});
        }
      },
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className='mt-4 flex flex-col gap-3'>
        <p className='text-center text-xs leading-5 text-muted-foreground'>
          Enter the 6-digit code from the email.
        </p>
        <FormField
          control={form.control}
          name='code'
          render={({field}) => (
            <FormItem className='flex flex-col items-center'>
              <FormControl>
                <InputOTP
                  data-testid='input-otp'
                  maxLength={6}
                  {...field}
                  value={String(field.value || '')}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode='numeric'
                  autoComplete='one-time-code'
                  aria-label='6-digit verification code'
                  containerClassName='w-full justify-center'
                  disabled={isVerifying}
                >
                  <InputOTPGroup className='grid w-full max-w-[20rem] grid-cols-6 gap-1'>
                    <InputOTPSlot index={0} className='h-11 w-full rounded-md border' />
                    <InputOTPSlot index={1} className='h-11 w-full rounded-md border' />
                    <InputOTPSlot index={2} className='h-11 w-full rounded-md border' />
                    <InputOTPSlot index={3} className='h-11 w-full rounded-md border' />
                    <InputOTPSlot index={4} className='h-11 w-full rounded-md border' />
                    <InputOTPSlot index={5} className='h-11 w-full rounded-md border' />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage className='pt-1 text-center' />
            </FormItem>
          )}
        />
        <Button
          type='submit'
          disabled={isVerifying || !form.formState.isValid}
          className='mt-1 w-full'
          data-testid='verify-button'
        >
          {isVerifying ? (
            <>
              <span>Verifying...</span>
              <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Verify email</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
