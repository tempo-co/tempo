import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {toast} from 'sonner';

import {useCurrentAccount} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';

export const useResendVerificationEmail = () => {
  const {isAuthenticated, isEmailVerified, currentAccount} = useCurrentAccount({skipFetch: true});
  const navigate = useNavigate();

  const {mutateAsync: resendVerificationEmail, isPending} = useMutation<void, HttpError, void>({
    mutationFn: async () => {
      if (isEmailVerified) {
        toast.info('Your email has already been verified.');
        throw navigate({to: '/'});
      }
      if (!isAuthenticated) {
        throw navigate({to: '/login'});
      }
      await api.post('/auth/signup/resend');
    },
    onSuccess: () => {
      toast.success('New verification email sent', {
        description: `Please check your inbox at ${currentAccount?.email}`,
      });
    },
    retry: false,
  });

  return {resendVerificationEmail, isPending};
};
