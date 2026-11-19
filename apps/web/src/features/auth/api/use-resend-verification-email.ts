import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useCurrentAccount} from '@/hooks/use-current-account';
import {HttpError, SessionChangedError, api, wasToasted} from '@/utils/api';

import {useContinueVerified} from './use-verify-email';

/** The API's refusal when the account was verified since this tab last checked, e.g. in another browser. */
const EMAIL_ALREADY_VERIFIED_MESSAGE = 'Email is already verified.';

type ResendOptions = {
  onSuccess?: () => void;
};

type ResendResult = 'sent' | 'already-verified';

/**
 * Resolves once the email is sent, or once an account verified elsewhere has moved on into the
 * app. Other failures reject after a toast; a signed-out tab is sent to /login by the query client.
 */
export const useResendVerificationEmail = () => {
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const continueVerified = useContinueVerified();

  const {mutateAsync: resendVerificationEmail, isPending} = useMutation<
    ResendResult,
    HttpError,
    ResendOptions | void
  >({
    mutationFn: async () => {
      try {
        await api.post('/auth/signup/resend');
        return 'sent';
      } catch (error) {
        if (
          error instanceof HttpError &&
          error.status === 400 &&
          error.message === EMAIL_ALREADY_VERIFIED_MESSAGE
        ) {
          await continueVerified({alreadyVerified: true});
          return 'already-verified';
        }
        throw error;
      }
    },
    onSuccess: (result, variables) => {
      if (result === 'already-verified') return;
      toast.success('New verification email sent', {
        description: `Please check your inbox at ${currentAccount?.email}`,
      });
      if (variables?.onSuccess) variables.onSuccess();
    },
    onError: (error) => {
      // A reply that arrives after logging out belongs to a request the user abandoned.
      if (!wasToasted(error) && !(error instanceof SessionChangedError))
        toast.error('Could not send a new verification email. Please try again.');
    },
  });

  return {resendVerificationEmail, isPending};
};
