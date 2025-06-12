import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {Loader} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {cn} from '@/utils/cn';

import {useLogIn} from '../api/use-login';
import {LogInDto, logInDtoSchema} from '../types/login.dto';

export function LogInForm() {
  const [hasUnauthorizedError, setHasUnauthorizedError] = useState<boolean>(false);

  const {logIn, isPending} = useLogIn();

  const form = useForm<LogInDto>({
    resolver: zodResolver(logInDtoSchema),
    mode: 'onSubmit',
  });

  useEffect(() => {
    const subscription = form.watch((_, {name}) => {
      if ((name === 'email' || name === 'password') && hasUnauthorizedError) {
        form.clearErrors('email');
        form.clearErrors('password');
        setHasUnauthorizedError(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, hasUnauthorizedError]);

  function onSubmit(formData: LogInDto) {
    if (hasUnauthorizedError) {
      setHasUnauthorizedError(false);
    }

    logIn(formData, {
      onError: (error) => {
        if (error.status === 401) {
          form.setError('email', {message: ''});
          form.setError('password', {message: 'Invalid email or password.'});
          setHasUnauthorizedError(true);
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
                    placeholder='example@domain.com'
                    type='email'
                    autoCapitalize='none'
                    autoComplete='email'
                    autoCorrect='off'
                    disabled={isPending}
                    className={cn(fieldState.error && 'border-destructive')}
                    data-testid='login-email-input'
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
                <div className='flex items-center justify-between'>
                  <FormLabel htmlFor='password'>Password</FormLabel>
                  <Button variant='link' asChild className='h-fit p-0 pl-1'>
                    <Link to='/reset-password' data-testid='forgot-password-link'>
                      Forgot your password?
                    </Link>
                  </Button>
                </div>
                <FormControl>
                  <PasswordInputField<LogInDto, 'password'>
                    field={field}
                    fieldState={fieldState}
                    id='password'
                    autoComplete='current-password'
                    disabled={isPending}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button type='submit' disabled={isPending} className='mt-2' data-testid='login-submit'>
            {isPending ? (
              <>
                <span>Logging in...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Log in</span>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
