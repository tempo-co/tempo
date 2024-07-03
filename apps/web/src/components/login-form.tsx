import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useEffect, useState} from 'react';
import {LoaderCircle, Eye, EyeOff} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Link} from '@tanstack/react-router';
import {useMutation} from '@tanstack/react-query';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {z} from 'zod';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'sonner';

const formSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email address.')
    .max(255, 'Email address must be less than 256 characters.')
    .email('Please enter a valid email address.')
    .default(''),
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.')
    .default(''),
});

export function LogInForm() {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [hasUnauthorizedError, setHasUnauthorizedError] = useState<boolean>(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {email: '', password: ''},
  });

  const {mutate, isPending} = useMutation({
    mutationFn: async (formData: z.infer<typeof formSchema>) => {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(formData),
      });
      console.log(response.status);
      switch (response.status) {
        case 200:
          return response.json();
        case 401:
          form.setError('email', {message: ''});
          form.setError('password', {message: 'Invalid email or password. Please try again.'});
          setHasUnauthorizedError(true);
          break;
        case 400:
          toast.error('Validation failed.', {
            description: 'Please check your input and try again.',
          });
          break;
        default:
          throw new Error('Network response was not ok.');
      }
    },
    onError: () => {
      toast.error('There was a problem with your request.', {
        description: 'Your account could not be created. Please try again.',
      });
    },
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

  function onSubmit(formData: z.infer<typeof formSchema>) {
    mutate(formData);
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
