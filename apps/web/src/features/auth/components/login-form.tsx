import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useEffect, useState} from 'react';
import {LoaderCircle, Eye, EyeOff} from 'lucide-react';
import {cn} from '@/utils/cn';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Link} from '@tanstack/react-router';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'sonner';
import {useLogIn} from '../api/use-login';
import {LogInDto, logInDtoSchema} from '../types/login.dto';

export function LogInForm() {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [hasUnauthorizedError, setHasUnauthorizedError] = useState<boolean>(false);

  const {logIn, isPending} = useLogIn();

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
          form.setError('password', {message: 'Invalid email or password. Please try again.'});
          setHasUnauthorizedError(true);
        } else {
          toast.error('Validation failed.', {
            description: 'Please check your input and try again.',
          });
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
                <div className='flex justify-between items-center w-full'>
                  <FormLabel>Password</FormLabel>
                  <Link className='text-sm underline decoration-accent hover:decoration-foreground underline-offset-4 font-medium'>
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
                                'border-l-0 rounded-l-none',
                                fieldState.error && 'border-destructive',
                              )}
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
                <LoaderCircle className='ml-2 h-4 w-4 animate-spin' />
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
