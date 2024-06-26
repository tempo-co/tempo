import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useState} from 'react';
import {LoaderCircle, Eye, EyeOff} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';

export function SignUpForm() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
    }, 3000);
  }

  function togglePasswordVisibility() {
    setIsPasswordVisible(!isPasswordVisible);
  }

  function handlePasswordChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value);
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid gap-6'>
        <div className='grid gap-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            placeholder='name@example.com'
            type='email'
            autoCapitalize='none'
            autoComplete='email'
            autoCorrect='off'
            disabled={isLoading}
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='name'>Full name</Label>
          <Input
            id='name'
            type='text'
            autoCapitalize='none'
            autoComplete='name'
            autoCorrect='off'
            disabled={isLoading}
          />
        </div>
        <div className='grid gap-2 items-center'>
          <Label htmlFor='password'>Password</Label>
          <div className='flex'>
            <Input
              id='password'
              type={isPasswordVisible ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              autoCapitalize='none'
              autoComplete='current-password'
              autoCorrect='off'
              disabled={isLoading}
              className={cn('z-10', password && 'rounded-r-none')}
            ></Input>
            {password && (
              <TooltipProvider delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={togglePasswordVisibility}
                      variant='outline'
                      type='button'
                      className='border-l-0 rounded-l-none'
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
        </div>
        <Button disabled={isLoading} className='bg-accent-foreground hover:bg-accent-foreground/90'>
          {isLoading ? (
            <>
              <LoaderCircle className='mr-2 h-4 w-4 animate-spin' /> Creating account
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </div>
    </form>
  );
}
