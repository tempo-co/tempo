import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {useState} from 'react';
import {LoaderCircle, Eye, EyeOff} from 'lucide-react';
import {cn} from '@/lib/utils';
import {z} from 'zod';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {PasswordStrengthIndicator} from './password-strength-indicator';
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

const formSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email address.')
    .max(255, 'Email must be less than 256 characters.')
    .email('Please enter a valid email address.'),
  name: z
    .string()
    .min(1, 'Please enter your name.')
    .max(255, 'Name must be less than 256 characters.'),
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.'),
});

export function SignUpForm() {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [passwordStrength, setPasswordStrength] = useState<number>(0);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      email: '',
      name: '',
      password: '',
    },
  });

  const {mutate, isPending} = useMutation({
    mutationFn: async (formData: z.infer<typeof formSchema>) => {
      const response = await fetch('http://localhost:3000/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      if (response.status === 409) {
        form.setError('email', {message: 'Email is already in use'}, {shouldFocus: true});
        return;
      }
      if (response.status != 201) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    },
    onError: () => {
      toast.error('There was a problem with your request.', {
        description: 'Your account could not be created. Please try again.',
      });
    },
  });

  function onSubmit(formData: z.infer<typeof formSchema>) {
    if (passwordStrength <= 25) {
      form.setError('password', {message: ''}, {shouldFocus: true});
      return;
    }
    mutate(formData);
  }

  function togglePasswordVisibility() {
    setIsPasswordVisible(!isPasswordVisible);
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
            name='name'
            render={({field, fieldState}) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='name'
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
                        (fieldState.error || (fieldState.isTouched && passwordStrength <= 25)) &&
                          'border-destructive',
                      )}
                    />
                    {field.value && (
                      <TooltipProvider delayDuration={500}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={togglePasswordVisibility}
                              variant='outline'
                              type='button'
                              className={cn(
                                'border-l-0 rounded-l-none',
                                (fieldState.error ||
                                  (fieldState.isTouched && passwordStrength <= 25)) &&
                                  'border-destructive',
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
                {field.value.length >= 8 && field.value.length < 256 && (
                  <PasswordStrengthIndicator
                    value={field.value}
                    passwordStrength={passwordStrength}
                    setPasswordStrength={setPasswordStrength}
                  />
                )}
              </FormItem>
            )}
          />
          <Button type='submit' disabled={isPending}>
            {isPending ? (
              <>
                <span>Creating account...</span>
                <LoaderCircle className='ml-2 h-4 w-4 animate-spin' />
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
