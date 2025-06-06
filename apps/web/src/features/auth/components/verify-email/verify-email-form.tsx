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
    mode: 'onSubmit',
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
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className='space-y-4'>
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
                  disabled={isVerifying}
                >
                  <InputOTPGroup className='gap-4'>
                    <InputOTPSlot index={0} className='rounded-md' />
                    <InputOTPSlot index={1} className='rounded-md border-l' />
                    <InputOTPSlot index={2} className='rounded-md border-l' />
                    <InputOTPSlot index={3} className='rounded-md border-l' />
                    <InputOTPSlot index={4} className='rounded-md border-l' />
                    <InputOTPSlot index={5} className='rounded-md border-l' />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage className='pt-1' />
            </FormItem>
          )}
        />
        <Button
          type='submit'
          disabled={isVerifying || !form.formState.isValid}
          className='w-full'
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
