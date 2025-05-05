import {Loader} from 'lucide-react';
import {UseFormReturn} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {DialogClose, DialogFooter} from '@/components/ui/dialog';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {useMediaQuery} from '@/hooks/use-media-query';
import {Account} from '@/types/account';
import {cn} from '@/utils/cn';

import {useCheckEmailAvailability} from '../../api/use-check-email-availability';
import {EmailChangeDto} from '../../types/email-change.dto';

type EmailChangeCheckFormProps = {
  form: UseFormReturn<EmailChangeDto>;
  currentEmail: Account['email'];
  setStep: React.Dispatch<React.SetStateAction<'check' | 'request'>>;
};

export function EmailChangeCheckForm({form, currentEmail, setStep}: EmailChangeCheckFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {checkEmailAvailability, isPending} = useCheckEmailAvailability();

  async function onSubmit(formData: EmailChangeDto) {
    if (formData.newEmail === currentEmail) {
      form.setError(
        'newEmail',
        {message: 'Please enter a different email from your current one.'},
        {shouldFocus: true},
      );
      return;
    }

    await checkEmailAvailability(formData.newEmail, {
      onError: (error) => {
        if (error.status === 409) {
          form.setError(
            'newEmail',
            {message: 'This email is already in use.'},
            {shouldFocus: true},
          );
        }
      },
      onSuccess: () => {
        setStep('request');
      },
    });
  }

  return (
    <div className={cn(!isDesktop && 'mb-8 px-4')}>
      <Form {...form}>
        <form
          className={cn('grid items-start gap-4')}
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <FormField
            control={form.control}
            name='newEmail'
            render={({field, fieldState}) => (
              <FormItem>
                <FormLabel>Enter the new email you&apos;d like to use</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='newEmail'
                    placeholder='example@domain.com'
                    type='email'
                    autoCapitalize='none'
                    autoComplete='email'
                    autoCorrect='off'
                    disabled={isPending}
                    className={cn(fieldState.error && 'border-destructive')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
            <Button type='submit' disabled={isPending} className={cn(!isDesktop && 'w-full')}>
              {isPending ? (
                <>
                  <span>Checking...</span>
                  <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                </>
              ) : (
                <span>Check for existing account</span>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
