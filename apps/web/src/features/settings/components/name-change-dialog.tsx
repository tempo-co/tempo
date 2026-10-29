import {zodResolver} from '@hookform/resolvers/zod';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {Account} from '@/types/account';

import {usePatchAccount} from '../api/use-patch-account';
import {NameChangeDto, nameChangeDtoSchema} from '../types/name-change.dto';

type NameChangeDialogProps = {
  currentName: Account['name'];
};

export function NameChangeDialog({currentName}: NameChangeDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {patchAccount, isPending} = usePatchAccount();

  const form = useForm<NameChangeDto>({
    resolver: zodResolver(nameChangeDtoSchema),
    mode: 'onSubmit',
    defaultValues: {name: currentName},
  });

  // Closing while a save runs is allowed: the toast reports its outcome.
  const handleOpenChange = (open: boolean) => {
    // Start from the saved name every time, never from an abandoned edit.
    form.reset({name: currentName});
    setIsOpen(open);
  };

  const onSubmit = async ({name}: NameChangeDto) => {
    const trimmedName = name.trim();
    if (trimmedName === currentName.trim()) {
      setIsOpen(false);
      return;
    }
    try {
      await patchAccount({name: trimmedName}).unwrap();
      setIsOpen(false);
    } catch {
      // The toast reports the failure; keep the dialog open so the edit is not lost.
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='min-w-20 max-sm:h-11'
          data-testid='edit-name-button'
        >
          Edit
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-md'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Edit name</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form className='grid gap-4' onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ResponsiveDialogBody>
              <FormField
                control={form.control}
                name='name'
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id='name'
                        type='text'
                        autoComplete='name'
                        disabled={isPending}
                        data-testid='name-input'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter className='gap-2'>
              <Button
                type='submit'
                disabled={isPending}
                className='md:order-2'
                data-testid='save-name-button'
              >
                {isPending ? <PendingLabel>Saving…</PendingLabel> : 'Save'}
              </Button>
              <ResponsiveDialogClose asChild>
                <Button variant='outline' type='button' className='md:order-1'>
                  {isPending ? 'Close' : 'Cancel'}
                </Button>
              </ResponsiveDialogClose>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
