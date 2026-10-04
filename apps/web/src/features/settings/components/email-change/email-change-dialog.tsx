import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
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
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {Account} from '@/types/account';
import {cn} from '@/utils/cn';

import {useChangeEmailRequest} from '../../api/use-change-email-request';
import {EmailChangeDto, emailChangeDtoSchema} from '../../types/email-change.dto';

type EmailChangeDialogProps = {
  currentEmail: Account['email'];
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function EmailChangeDialog({currentEmail}: EmailChangeDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {changeEmailRequest, isPending} = useChangeEmailRequest();

  const form = useForm<EmailChangeDto>({
    resolver: zodResolver(emailChangeDtoSchema),
    mode: 'onSubmit',
    defaultValues: {newEmail: ''},
  });

  const handleOpenChange = (open: boolean) => {
    if (isPending) return;
    setIsOpen(open);
    if (!open) {
      setSentTo(null);
      form.reset();
    }
  };

  const onSubmit = ({newEmail}: EmailChangeDto) => {
    const email = normalizeEmail(newEmail);
    if (email === normalizeEmail(currentEmail)) {
      form.setError('newEmail', {message: 'This is already your email.'}, {shouldFocus: true});
      return;
    }

    changeEmailRequest(
      {newEmail: email},
      {
        onSuccess: () => setSentTo(email),
        onError: (error) => {
          const message =
            error.status === 409
              ? 'Another account already uses this email.'
              : 'Something went wrong. Please try again.';
          form.setError('newEmail', {message}, {shouldFocus: true});
        },
      },
    );
  };

  const useDifferentEmail = () => {
    setSentTo(null);
    form.reset();
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='ghost'
          className='min-h-11 w-full sm:w-auto'
          data-testid='change-email-button'
        >
          Change
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-md'>
        {sentTo ? (
          <>
            <ResponsiveDialogHeader className='text-start'>
              <ResponsiveDialogTitle>Check your inbox</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className='pt-2'>
                We sent a verification link to
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className='space-y-3 text-sm text-muted-foreground'>
              <p
                className='font-medium break-all text-foreground'
                data-testid='email-change-sent-to'
              >
                {sentTo}
              </p>
              <p>Your email changes when you open the link.</p>
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter className='gap-2'>
              <ResponsiveDialogClose asChild>
                <Button type='button' className='md:order-2' data-testid='email-change-done-button'>
                  Done
                </Button>
              </ResponsiveDialogClose>
              <Button
                variant='outline'
                type='button'
                onClick={useDifferentEmail}
                className='md:order-1'
                data-testid='use-different-email-button'
              >
                Use a different email
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <>
            <ResponsiveDialogHeader className='text-start'>
              <ResponsiveDialogTitle>Change email</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className='pt-2'>
                We&apos;ll send a verification link to your new address. Your current email,{' '}
                <span className='break-all text-foreground'>{currentEmail}</span>, stays active
                until you confirm.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <Form {...form}>
              <form className='grid gap-4' onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <ResponsiveDialogBody>
                  <FormField
                    control={form.control}
                    name='newEmail'
                    render={({field, fieldState}) => (
                      <FormItem>
                        <FormLabel>New email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            id='newEmail'
                            type='email'
                            autoCapitalize='none'
                            autoComplete='email'
                            autoCorrect='off'
                            spellCheck={false}
                            disabled={isPending}
                            className={cn(fieldState.error && 'border-destructive')}
                            data-testid='new-email-input'
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
                    data-testid='send-verification-link-button'
                  >
                    {isPending ? (
                      <>
                        <span>Sending…</span>
                        <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                      </>
                    ) : (
                      'Send verification link'
                    )}
                  </Button>
                  <ResponsiveDialogClose asChild>
                    <Button
                      variant='outline'
                      type='button'
                      disabled={isPending}
                      className='md:order-1'
                    >
                      Cancel
                    </Button>
                  </ResponsiveDialogClose>
                </ResponsiveDialogFooter>
              </form>
            </Form>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
