import {zodResolver} from '@hookform/resolvers/zod';
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

type LogInFormProps = {
  returnTo?: string;
};

export function LogInForm({returnTo}: LogInFormProps) {
  const [hasUnauthorizedError, setHasUnauthorizedError] = useState<boolean>(false);

  const {logIn, isPending} = useLogIn({returnTo});

  const form = useForm<LogInDto>({
    resolver: zodResolver(logInDtoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
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
              <PasswordInputField<LogInDto, 'password'>
                field={field}
                fieldState={fieldState}
                label='Password'
                id='password'
                autoComplete='current-password'
                disabled={isPending}
              />
            )}
          />
          <Button type='submit' disabled={isPending} className='mt-2'>
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
