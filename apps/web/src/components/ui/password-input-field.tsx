import {Eye, EyeOff} from 'lucide-react';
import {useState} from 'react';
import {ControllerFieldState, ControllerRenderProps, FieldPath, FieldValues} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {FormControl, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

type PasswordInputFieldProps<T extends FieldValues, K extends FieldPath<T>> = {
  field: ControllerRenderProps<T, K>;
  fieldState: ControllerFieldState;
  label?: string;
  id: string;
  autoComplete: string;
  disabled?: boolean;
};

export function PasswordInputField<T extends FieldValues, K extends FieldPath<T>>({
  field,
  fieldState,
  label,
  id,
  autoComplete,
  disabled = false,
  ...inputProps
}: PasswordInputFieldProps<T, K>) {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);

  return (
    <FormItem>
      {label && <FormLabel>{label}</FormLabel>}
      <FormControl>
        <div className='flex'>
          <Input
            {...field}
            {...inputProps}
            id={id}
            data-testid='password-input'
            type={isPasswordVisible ? 'text' : 'password'}
            autoCapitalize='none'
            autoComplete={autoComplete}
            autoCorrect='off'
            disabled={disabled}
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
                    disabled={disabled}
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
  );
}
