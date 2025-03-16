import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {Eye, EyeOff, Loader} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

import {useLogIn} from '../api/use-login';
import {LogInDto, logInDtoSchema} from '../types/login.dto';

type LogInFormProps = {
  returnTo?: string;
};

export function LogInForm({returnTo}: LogInFormProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [hasUnauthorizedError, setHasUnauthorizedError] = useState<boolean>(false);

  const {logIn, isPending} = useLogIn({returnTo});

  const form = useForm<LogInDto>({
    resolver: zodResolver(logInDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {email: '', password: ''},
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
        <div className='grid gap-6'>
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
              <FormItem>
                <div className='flex w-full items-center justify-between'>
                  <FormLabel>Password</FormLabel>
                  <Link
                    to='/'
                    className='text-sm font-medium underline decoration-accent underline-offset-4 hover:decoration-foreground'
                  >
                    Forgot your password?
                  </Link>
                </div>
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
          <Button type='submit' disabled={isPending}>
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
