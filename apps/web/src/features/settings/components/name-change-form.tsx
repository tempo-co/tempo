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
  FormMessage,
} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {User} from '@/types/user';
import {cn} from '@/utils/cn';

import {usePatchUser} from '../api/use-patch-user';
import {NameChangeDto, nameChangeDtoSchema} from '../types/name-change.dto';

type NameChangeFormProps = {
  currentName: User['name'];
};

export function NameChangeForm({currentName}: NameChangeFormProps) {
  const {patchUser, isPending} = usePatchUser();

  const form = useForm<NameChangeDto>({
    resolver: zodResolver(nameChangeDtoSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {name: currentName},
  });

  function onSubmit(formData: NameChangeDto) {
    patchUser(formData);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className='flex flex-col gap-2 sm:flex-row'
      >
        <FormField
          control={form.control}
          name='name'
          render={({field, fieldState}) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  id='name'
                  placeholder='Username'
                  type='text'
                  autoCapitalize='none'
                  autoComplete='name'
                  autoCorrect='off'
                  disabled={isPending}
                  className={cn(fieldState.error && 'border-destructive')}
                />
              </FormControl>
              <FormMessage />
              <FormDescription className='sm:mr-10'>
                This is your display name. It can be your real name or an alias.
              </FormDescription>
            </FormItem>
          )}
        />
        <Button
          type='submit'
          disabled={isPending || form.watch('name') === currentName}
          className='mt-2 w-full sm:mt-0 sm:w-fit'
        >
          {isPending ? (
            <>
              <span>Saving...</span>
              <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
            </>
          ) : (
            <span>Save</span>
          )}
        </Button>
      </form>
    </Form>
  );
}
