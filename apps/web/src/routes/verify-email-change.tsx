import {createFileRoute, redirect, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useEffect, useRef} from 'react';
import {toast} from 'sonner';

import {useVerifyEmailChange} from '@/features/auth/api/use-verify-email-change';
import {tokenSearchParamsSchema} from '@/features/auth/types/token.dto';

export const Route = createFileRoute('/verify-email-change')({
  component: VerifyEmailChangeIndex,
  validateSearch: zodValidator(tokenSearchParamsSchema),
  beforeLoad: ({context, search, location}) => {
    const hasValidParams = !!(search.token && search.email);
    if (!hasValidParams) {
      toast.error('This verification link is invalid.', {id: 'invalid-verification-link'});
      throw redirect({to: '/'});
    }

    if (!context.isAuthenticated) {
      toast.info('Log in to finish changing your email.', {id: 'email-change-login-required'});
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function VerifyEmailChangeIndex() {
  const navigate = useNavigate();
  const {token, email} = Route.useSearch();
  const {verifyEmailChange} = useVerifyEmailChange();
  const hasStarted = useRef(false);

  useEffect(() => {
    // Tokens are single-use, so a second (StrictMode) run would report a false failure.
    if (hasStarted.current || !token || !email) return;
    hasStarted.current = true;

    verifyEmailChange({token, email});
    void navigate({to: '/settings/account', replace: true});
  }, [email, navigate, token, verifyEmailChange]);

  return null;
}
