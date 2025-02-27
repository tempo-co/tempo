import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {cn} from '@/utils/cn';

import {useCreateAccount} from '../../api/use-create-account';
import {AccountCreateDto, accountCreateDtoSchema} from '../../types/account-create.dto';
import {BankComboBox} from './bank-combo-box';

type AccountAddFormProps = {
  className?: string;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function AccountAddForm({className, setOpen}: AccountAddFormProps) {
  const {createAccount, isPending} = useCreateAccount();

  const form = useForm<AccountCreateDto>({
    resolver: zodResolver(accountCreateDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });

  function onSubmit(formData: AccountCreateDto) {
    createAccount(formData);
    setOpen(false);
  }

  return (
    <Form {...form}>
      <form
        className={cn('grid items-start gap-4', className)}
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <FormField
          control={form.control}
          name='bank'
          render={({field, fieldState}) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Bank</FormLabel>
              <FormControl>
                <BankComboBox
                  onChange={field.onChange}
                  isPending={isPending}
                  error={fieldState.invalid}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='alias'
          render={({field, fieldState}) => (
            <FormItem>
              <FormLabel>
                Alias <span className='text-muted-foreground'>(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id='alias'
                  type='text'
                  autoCapitalize='none'
                  autoCorrect='off'
                  disabled={isPending}
                  className={cn(fieldState.invalid && 'border-destructive')}
                />
              </FormControl>
              <FormDescription>A unique name to easily identify this account.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={isPending} className='mt-4'>
          {isPending ? (
            <>
              <span>Adding account...</span>
              <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Add account</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
