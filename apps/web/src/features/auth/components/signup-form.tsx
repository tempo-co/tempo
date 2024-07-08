import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {useState} from 'react';
import {LoaderCircle, Eye, EyeOff} from 'lucide-react';
import {cn} from '@/utils/cn';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {PasswordStrengthIndicator} from './password-strength-indicator';
import {toast} from 'sonner';
import {useSignUp} from '../api/use-signup';
import {SignUpDto, signUpDtoSchema} from '../types/signup-dto';

export function SignUpForm() {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [passwordStrength, setPasswordStrength] = useState<number>(0);

  const {mutate, isPending} = useSignUp();

  const form = useForm<SignUpDto>({
    resolver: zodResolver(signUpDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {email: '', name: '', password: ''},
  });

  function onSubmit(formData: SignUpDto) {
    if (passwordStrength <= 25) {
      form.setError('password', {message: ''}, {shouldFocus: true});
      return;
    }

    mutate(formData, {
      onError: (error) => {
        if (error.status === 409) {
          form.setError(
            'email',
            {message: 'This email address is already in use.'},
            {shouldFocus: true},
          );
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
                              onClick={() => setIsPasswordVisible(!isPasswordVisible)}
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
