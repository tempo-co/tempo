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

const formSchema = z.object({
  email: z
    .string()
    .min(1, 'Required')
    .max(255, 'Must be less than 256 characters')
    .email('Invalid'),
  name: z.string().min(1, 'Required').max(255, 'Must be less than 256 characters'),
  password: z
    .string()
    .min(8, 'Must be at least 8 characters')
    .max(255, 'Must be less than 256 characters'),
});

export function SignUpForm() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);

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

  function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values);
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
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
            render={({field}) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='email'
                    placeholder='name@example.com'
                    type='email'
                    autoCapitalize='none'
                    autoComplete='email'
                    autoCorrect='off'
                    disabled={isLoading}
                    className={cn(form.getFieldState('email').error && 'border-destructive')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='name'
            render={({field}) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id='name'
                    type='text'
                    autoCapitalize='none'
                    autoComplete='name'
                    autoCorrect='off'
                    disabled={isLoading}
                    className={cn(form.getFieldState('name').error && 'border-destructive')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='password'
            render={({field}) => (
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
                      disabled={isLoading}
                      className={cn(
                        'z-10',
                        field.value && 'rounded-r-none border-r-0',
                        form.getFieldState('password').error && 'border-destructive',
                      )}
                    ></Input>
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
                                form.getFieldState('password').error && 'border-destructive',
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
                <PasswordStrengthIndicator value={field.value} />
              </FormItem>
            )}
          />
          <Button
            type='submit'
            disabled={isLoading}
            className='bg-accent-foreground hover:bg-accent-foreground/90'
          >
            {isLoading ? (
              <>
                <LoaderCircle className='mr-2 h-4 w-4 animate-spin' />
                <span>Creating account</span>
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
