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
import {User} from '@/types/user';
import {cn} from '@/utils/cn';

import {usePatchUser} from '../api/use-patch-user';
import {UsernameChangeDto, usernameChangeDtoSchema} from '../types/username-change.dto';

type UsernameChangeFormProps = {
  currentUsername: User['username'];
};

export function UsernameChangeForm({currentUsername}: UsernameChangeFormProps) {
  const {patchUser, isPending} = usePatchUser();

  const form = useForm<UsernameChangeDto>({
    resolver: zodResolver(usernameChangeDtoSchema),
    mode: 'onChange',
    defaultValues: {username: currentUsername},
  });

  const watchedUsername = form.watch('username');

  const handleBlur = async () => {
    const isValid = await form.trigger('username');

    const hasNameChanged = watchedUsername.trim() !== currentUsername.trim();
    const isValidName = isValid && watchedUsername.trim() !== '';

    if (hasNameChanged && isValidName) {
      const trimmedName = {username: form.getValues().username.trim()};
      patchUser(trimmedName);
    }
  };

  useEffect(() => {
    const submissionAttemptFailed =
      form.formState.isSubmitted && !isPending && !form.formState.isSubmitSuccessful;

    if (submissionAttemptFailed) {
      form.reset({username: currentUsername});
    }
  }, [form, currentUsername, isPending]);

  return (
    <Form {...form}>
      <form className='flex flex-col gap-2' noValidate>
        <FormField
          control={form.control}
          name='username'
          render={({field, fieldState}) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  id='username'
                  placeholder='Enter your username'
                  type='text'
                  autoCapitalize='none'
                  autoComplete='username'
                  autoCorrect='off'
                  disabled={isPending}
                  className={cn(fieldState.error && 'border-destructive')}
                  onChange={async (e) => {
                    field.onChange(e);
                    await form.trigger('username');
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
