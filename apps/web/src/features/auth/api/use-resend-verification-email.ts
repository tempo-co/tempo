import {useMutation} from '@tanstack/react-query';
import {useRouter} from '@tanstack/react-router';
import {toast} from 'sonner';

import {useCurrentAccount} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';

type ResendOptions = {
  onSuccess?: () => void;
};

export const useResendVerificationEmail = () => {
  const {isAuthenticated, isEmailVerified, currentAccount} = useCurrentAccount({skipFetch: true});
  const router = useRouter();

  const {mutateAsync: resendVerificationEmail, isPending} = useMutation<
    void,
    HttpError,
    ResendOptions | void
  >({
    mutationFn: async () => {
      if (isEmailVerified) {
        toast.info('Your email has already been verified.', {id: 'email-already-verified'});
        throw router.navigate({to: '/'});
      }
      if (!isAuthenticated) {
        throw router.navigate({to: '/login'});
      }
      await api.post('/auth/signup/resend');
    },
    onSuccess: (_, variables) => {
      toast.success('New verification email sent', {
        description: `Please check your inbox at ${currentAccount?.email}`,
      });
      if (variables?.onSuccess) variables.onSuccess();
    },
    retry: false,
  });

  return {resendVerificationEmail, isPending};
};
