import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {cn} from '@/utils/cn';

import {useSignUp} from '../api/use-signup';
import {SignUpDto, signUpDtoSchema} from '../types/signup.dto';

export function SignUpForm() {
  const {signUp, isPending} = useSignUp();

  const form = useForm<SignUpDto>({
    resolver: zodResolver(signUpDtoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(formData: SignUpDto) {
    await signUp(formData, {
      onError: (error) => {
        if (error.status === 409) {
          form.setError('email', {message: 'This email is already in use.'}, {shouldFocus: true});
        }
      },
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className='grid gap-4'>
          <FormField
            control={form.control}
            name='email'
            render={({field, fieldState}) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='email'
                    data-testid='signup-email'
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
            name='name'
            render={({field, fieldState}) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='name'
                    data-testid='signup-name'
                    type='text'
                    autoCapitalize='none'
                    autoComplete='name'
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
              <PasswordInputField<SignUpDto, 'password'>
                data-testid='signup-password'
                field={field}
                fieldState={fieldState}
                label='Password'
                id='password'
                autoComplete='new-password'
                disabled={isPending}
              />
            )}
          />
          <Button type='submit' data-testid='signup-submit' disabled={isPending} className='mt-2'>
            {isPending ? (
              <>
                <span>Creating account...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Create account</span>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
