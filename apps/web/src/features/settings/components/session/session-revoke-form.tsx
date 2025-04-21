import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {DialogClose, DialogFooter} from '@/components/ui/dialog';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {useRevokeSession} from '../../api/use-revoke-session';
import {Session} from '../../types/session';
import {SessionRevokeDto, sessionRevokeDtoSchema} from '../../types/session-revoke.dto';

type SessionRevokeFormProps = {
  session: Session;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function SessionRevokeForm({session, setIsOpen}: SessionRevokeFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const {revokeSession, isPending} = useRevokeSession();

  const form = useForm<SessionRevokeDto>({
    resolver: zodResolver(sessionRevokeDtoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(dto: SessionRevokeDto) {
    await revokeSession(
      {id: session.id, dto},
      {
        onError: (error) => {
          if (error.status === 401) {
            form.setError('password', {message: 'Invalid password.'}, {shouldFocus: true});
          }
          if (error.status === 404) {
            setIsOpen(false);
          }
        },
        onSuccess: () => {
          setIsOpen(false);
        },
      },
    );
  }

  return (
    <Form {...form}>
      <form
        className={cn('grid items-start gap-4')}
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <FormField
          control={form.control}
          name='password'
          render={({field, fieldState}) => (
            <PasswordInputField<SessionRevokeDto, 'password'>
              field={field}
              fieldState={fieldState}
              label='Password'
              id='password'
              autoComplete='password'
              disabled={isPending}
            />
          )}
        />
        <div className='mt-4 flex w-full gap-4'>
          {isDesktop && (
            <DialogFooter className='w-full'>
              <DialogClose asChild>
                <Button variant='outline' type='button' className='w-full'>
                  Cancel
                </Button>
              </DialogClose>
            </DialogFooter>
          )}
          <Button
            type='submit'
            disabled={isPending}
            className='w-full text-foreground'
            variant='destructive'
          >
            {isPending ? (
              <>
                <span>Revoking session...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Revoke session</span>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
