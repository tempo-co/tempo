import {zodResolver} from '@hookform/resolvers/zod';
import {useEffect} from 'react';
import {useForm} from 'react-hook-form';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Account} from '@/types/account';
import {cn} from '@/utils/cn';

import {usePatchAccount} from '../api/use-patch-account';
import {NameChangeDto, nameChangeDtoSchema} from '../types/name-change.dto';

type NameChangeFormProps = {
  currentName: Account['name'];
};

export function NameChangeForm({currentName}: NameChangeFormProps) {
  const {patchAccount, isPending} = usePatchAccount();

  const form = useForm<NameChangeDto>({
    resolver: zodResolver(nameChangeDtoSchema),
    mode: 'onChange',
    defaultValues: {name: currentName},
  });

  const watchedName = form.watch('name');

  const handleBlur = async () => {
    const isValid = await form.trigger('name');

    const hasNameChanged = watchedName.trim() !== currentName.trim();
    const isValidName = isValid && watchedName.trim() !== '';

    if (hasNameChanged && isValidName) {
      const trimmedName = {name: form.getValues().name.trim()};
      patchAccount(trimmedName);
    }
  };

  useEffect(() => {
    const submissionAttemptFailed =
      form.formState.isSubmitted && !isPending && !form.formState.isSubmitSuccessful;

    if (submissionAttemptFailed) {
      form.reset({name: currentName});
    }
  }, [form, currentName, isPending]);

  return (
    <Form {...form}>
      <form className='flex flex-col gap-2' noValidate>
        <FormField
          control={form.control}
          name='name'
          render={({field, fieldState}) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  id='name'
                  placeholder='Enter your name'
                  type='text'
                  autoCapitalize='none'
                  autoComplete='name'
                  autoCorrect='off'
                  disabled={isPending}
                  className={cn(fieldState.error && 'border-destructive')}
                  onChange={async (e) => {
                    field.onChange(e);
                    await form.trigger('name');
                  }}
                  onBlur={async () => {
                    field.onBlur();
                    await handleBlur();
                  }}
                />
              </FormControl>
              <FormMessage />
              <FormDescription className='text-xs'>
                {isPending ? 'Saving changes...' : 'This can be a nickname or your real name.'}
              </FormDescription>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
