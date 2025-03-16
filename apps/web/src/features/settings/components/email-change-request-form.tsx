import {Eye, EyeOff, Loader} from 'lucide-react';
import {useState} from 'react';
import {UseFormReturn} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {DialogClose, DialogFooter} from '@/components/ui/dialog';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {useChangeEmailRequest} from '../api/use-change-email-request';
import {EmailChangeDto} from '../types/email-change.dto';
import {EmailChangeVerifyForm} from './email-change-verify-form';

type EmailChangeRequestFormProps = {
  form: UseFormReturn<EmailChangeDto>;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  step: 'change' | 'verify';
  setStep: React.Dispatch<React.SetStateAction<'change' | 'verify'>>;
  resendCooldown: number;
  setResendCooldown: React.Dispatch<React.SetStateAction<number>>;
  resetAfterSuccess: () => void;
};

export function EmailChangeRequestForm({
  form,
  setOpen,
  step,
  setStep,
  resendCooldown,
  setResendCooldown,
  resetAfterSuccess,
}: EmailChangeRequestFormProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {changeEmailRequest, isPending} = useChangeEmailRequest();

  async function onSubmit(formData: EmailChangeDto) {
    await changeEmailRequest(formData, {
      onError: (error) => {
        if (error.status === 401) {
          form.setError('password', {message: 'Invalid password.'}, {shouldFocus: true});
        }
        if (error.status === 409) {
          form.setError(
            'newEmail',
            {message: 'This email is already in use.'},
            {shouldFocus: true},
          );
        }
      },
      onSuccess: () => {
        setStep('verify');
      },
    });
  }

  return (
    <div className={cn(!isDesktop && 'px-4')}>
      {step === 'change' ? (
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
                  <FormLabel>New email</FormLabel>
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
            <FormField
              control={form.control}
              name='confirmNewEmail'
              render={({field, fieldState}) => (
                <FormItem>
                  <FormLabel>Confirm new email</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id='confirmNewEmail'
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
            <FormField
              control={form.control}
              name='password'
              render={({field, fieldState}) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <div className='flex'>
                      <Input
                        {...field}
                        id='password'
                        type={isPasswordVisible ? 'text' : 'password'}
                        autoCapitalize='none'
                        autoComplete='current-password'
                        autoCorrect='off'
                        disabled={isPending}
                        className={cn(
                          'z-10',
                          field.value && 'rounded-r-none border-r-0',
                          fieldState.error && 'border-destructive',
                        )}
                      />
                      {field.value && (
                        <TooltipProvider delayDuration={500}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                                variant='outline'
                                type='button'
                                className={cn(
                                  'rounded-l-none border-l-0',
                                  fieldState.error && 'border-destructive',
                                )}
                                disabled={isPending}
                              >
                                {isPasswordVisible ? (
                                  <EyeOff className='w-4 text-muted-foreground' />
                                ) : (
                                  <Eye className='w-4 text-muted-foreground' />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{isPasswordVisible ? 'Hide password' : 'Show password'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='mt-4 flex w-full gap-4'>
              {isDesktop && (
                <DialogFooter className='w-full'>
                  <DialogClose asChild>
                    <Button variant='outline' type='button' className='w-full'>
                      Cancel
                    </Button>
                  </DialogClose>
                </DialogFooter>
              )}
              <Button type='submit' disabled={isPending} className='w-full'>
                {isPending ? (
                  <>
                    <span>Sending email...</span>
                    <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                  </>
                ) : (
                  <span>Send verification code</span>
                )}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <EmailChangeVerifyForm
          setOpen={setOpen}
          emailChangeFormData={form.getValues()}
          resendCooldown={resendCooldown}
          setResendCooldown={setResendCooldown}
          resetAfterSuccess={resetAfterSuccess}
        />
      )}
    </div>
  );
}
