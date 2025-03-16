import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {toast} from 'sonner';

import {useCurrentUser} from '@/hooks/use-current-user';
import {HttpError, api} from '@/utils/api';

export const useResendVerificationEmail = () => {
  const {isAuthenticated, isEmailVerified} = useCurrentUser({skipFetch: true});
  const navigate = useNavigate();

  const {mutateAsync: resendVerificationEmail, isPending} = useMutation<void, HttpError, void>({
    mutationFn: async () => {
      if (isEmailVerified) {
        toast.info('Your email has already been verified.');
        throw navigate({to: '/home'});
      }
      if (!isAuthenticated) {
        throw navigate({to: '/login', search: {returnTo: location.pathname}});
      }
      await api.post('/auth/signup/resend');
    },
    onSuccess: () => {
      toast.success('New verification code sent', {
        description: 'Please check your email.',
      });
    },
    retry: false,
  });

  return {resendVerificationEmail, isPending};
};
