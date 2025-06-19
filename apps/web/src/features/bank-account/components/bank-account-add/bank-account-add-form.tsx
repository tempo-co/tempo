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
import {ResponsiveDialogClose} from '@/components/ui/responsive-dialog';
import {cn} from '@/utils/cn';

import {useCreateBankAccount} from '../../api/use-create-bank-account';
import {
  BankAccountCreateDto,
  bankAccountCreateDtoSchema,
} from '../../types/bank-account-create.dto';
import {BankComboBox} from './bank-combo-box';

type BankAccountAddFormProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankAccountAddForm({setIsOpen}: BankAccountAddFormProps) {
  const {createBankAccount, isPending} = useCreateBankAccount();

  const form = useForm<BankAccountCreateDto>({
    resolver: zodResolver(bankAccountCreateDtoSchema),
    mode: 'onSubmit',
  });

  async function onSubmit(formData: BankAccountCreateDto) {
    await createBankAccount(formData);
    setIsOpen(false);
  }

  return (
    <Form {...form}>
      <form className='grid items-start gap-4' onSubmit={form.handleSubmit(onSubmit)} noValidate>
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
              <FormDescription>A unique name to easily identify this bank account.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='flex flex-col justify-end gap-4 md:flex-row'>
          <Button type='submit' disabled={isPending} className='order-1 md:order-2'>
            {isPending ? (
              <div className='flex items-center justify-center'>
                <span>Adding bank account...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </div>
            ) : (
              'Add bank account'
            )}
          </Button>
          <ResponsiveDialogClose asChild className='order-2 mb-4 md:order-1 md:mb-0'>
            <Button variant='outline'>Close</Button>
          </ResponsiveDialogClose>
        </div>
      </form>
    </Form>
  );
}
