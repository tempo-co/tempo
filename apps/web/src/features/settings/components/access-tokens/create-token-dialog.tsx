import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useEffect, useState} from 'react';
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
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {useCreatePersonalAccessToken} from '../../api/use-personal-access-tokens';
import {
  CreatePersonalAccessTokenDto,
  TOKEN_LIFETIMES,
  createPersonalAccessTokenDtoSchema,
} from '../../types/create-personal-access-token.dto';
import {CopyField} from './copy-field';

type CreateTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the dialog closes, to place focus on a control that still exists. */
  onClosed?: () => void;
};

export function CreateTokenDialog({open, onOpenChange, onClosed}: CreateTokenDialogProps) {
  const [secret, setSecret] = useState<string>();
  const create = useCreatePersonalAccessToken(setSecret);
  const form = useForm<CreatePersonalAccessTokenDto>({
    resolver: zodResolver(createPersonalAccessTokenDtoSchema),
    defaultValues: {name: '', expiresInDays: 90},
  });

  const resetDialog = () => {
    setSecret(undefined);
    create.reset();
    form.reset({name: '', expiresInDays: 90});
  };

  // Every open starts clean, however it was opened; a close keeps its content until then, so a
  // closing reveal does not flash the create form. The secret leaves memory on the next open or unmount.
  useEffect(() => {
    if (open) resetDialog();
    // Runs only on the open transition; resetDialog is stable in what it clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (create.isPending) return;
    onOpenChange(nextOpen);
    if (!nextOpen) setTimeout(() => onClosed?.(), 250);
  };

  const submit = async (dto: CreatePersonalAccessTokenDto) => {
    try {
      await create.mutateAsync(dto);
    } catch {
      // Keep the entered name available for retry; the error is shown inside the dialog.
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className='md:max-w-132'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>
            {secret ? 'Copy your access token' : 'Create access token'}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {secret
              ? "Make sure to copy your access token now. You won't be able to see it again."
              : 'Create a read-only token for an MCP client.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {secret ? (
          <>
            <ResponsiveDialogBody className='space-y-5'>
              <CopyField
                id='created-access-token'
                label='Access token'
                value={secret}
                copyLabel='Copy token'
                errorMessage='Could not copy. Select the token and copy it manually.'
              />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose asChild>
                <Button className='max-sm:h-11'>Done</Button>
              </ResponsiveDialogClose>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className='grid gap-4' noValidate>
              <ResponsiveDialogBody className='space-y-3'>
                <FormField
                  control={form.control}
                  name='name'
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete='off' disabled={create.isPending} />
                      </FormControl>
                      <FormDescription>
                        A name to recognise this token by, such as the device or app using it.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='expiresInDays'
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Expiration</FormLabel>
                      <Select
                        disabled={create.isPending}
                        value={String(field.value ?? 'never')}
                        onValueChange={(value) =>
                          field.onChange(
                            TOKEN_LIFETIMES.find((lifetime) => lifetime.value === value)?.days ??
                              null,
                          )
                        }
                      >
                        <FormControl>
                          <SelectTrigger className='max-sm:h-11'>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TOKEN_LIFETIMES.map((lifetime) => (
                            <SelectItem key={lifetime.value} value={lifetime.value}>
                              {lifetime.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {create.isPending && (
                  <p role='status' className='text-sm text-muted-foreground'>
                    Keep this dialog open while your token is being created.
                  </p>
                )}
                {create.isError && (
                  <p role='alert' className='text-sm text-destructive'>
                    Your token could not be created. Please try again.
                  </p>
                )}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className='gap-2'>
                <Button
                  type='submit'
                  disabled={create.isPending}
                  className='max-sm:h-11 md:order-2'
                >
                  {create.isPending ? (
                    <>
                      <Loader className='size-4 animate-slow-spin' />
                      Creating…
                    </>
                  ) : (
                    'Create token'
                  )}
                </Button>
                <ResponsiveDialogClose asChild>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={create.isPending}
                    className='max-sm:h-11 md:order-1'
                  >
                    Cancel
                  </Button>
                </ResponsiveDialogClose>
              </ResponsiveDialogFooter>
            </form>
          </Form>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
