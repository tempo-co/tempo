import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {useForm} from 'react-hook-form';
import {AccountCreateDto, accountCreateDtoSchema} from '../types/account-create.dto';
import {zodResolver} from '@hookform/resolvers/zod';
import {useCreateAccount} from '../api/use-create-account';
import {Input} from '@/components/ui/input';
import {cn} from '@/utils/cn';
import {BankComboBox} from './bank-combo-box';
import {Button} from '@/components/ui/button';
import {LoaderCircle} from 'lucide-react';

export function AddAccountForm({className}: React.ComponentProps<'form'>) {
  const {createAccount, isPending} = useCreateAccount();

  const form = useForm<AccountCreateDto>({
    resolver: zodResolver(accountCreateDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });

  function onSubmit(formData: AccountCreateDto) {
    createAccount(formData);
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
          render={({field}) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Bank</FormLabel>
              <FormControl>
                <BankComboBox onChange={field.onChange} isPending={isPending} />
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
                  className={cn(fieldState.error && 'border-destructive')}
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
              <LoaderCircle className='ml-2 h-4 w-4 animate-spin' />
            </>
          ) : (
            <span>Add account</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
