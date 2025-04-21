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
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {useCreateBankAccount} from '../../api/use-create-bank-account';
import {
  BankAccountCreateDto,
  bankAccountCreateDtoSchema,
} from '../../types/bank-account-create.dto';
import {BankComboBox} from './bank-combo-box';

type BankAccountAddFormProps = {
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BankAccountAddForm({setOpen}: BankAccountAddFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {createBankAccount, isPending} = useCreateBankAccount();

  const form = useForm<BankAccountCreateDto>({
    resolver: zodResolver(bankAccountCreateDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });

  async function onSubmit(formData: BankAccountCreateDto) {
    await createBankAccount(formData);
    setOpen(false);
  }

  return (
    <Form {...form}>
      <form
        className={cn('grid items-start gap-4', !isDesktop && 'px-4')}
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
              <FormDescription>A unique name to easily identify this bank account.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={isPending} className='mt-4'>
          {isPending ? (
            <>
              <span>Adding bank account...</span>
              <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Add bank account</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
