import {createFileRoute, redirect, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useEffect} from 'react';
import {toast} from 'sonner';

import {useVerifyEmailChange} from '@/features/auth/api/use-verify-email-change';
import {searchParamsSchema} from '@/features/auth/types/email-change-verify.dto';

export const Route = createFileRoute('/verify-email-change')({
  component: VerifyEmailChangeIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({search}) => {
    const hasValidParams = !!(search.token && search.email);
    if (!hasValidParams) {
      toast.error('This verification link is invalid.', {id: 'invalid-verification-link'});
      throw redirect({to: '/'});
    }
  },
});

function VerifyEmailChangeIndex() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const {verifyEmailChange} = useVerifyEmailChange();

  const hasValidParams = !!(search.token && search.email);
  useEffect(() => {
    void navigate({to: '/'});
    if (hasValidParams) {
      verifyEmailChange(search);
    }
  }, [hasValidParams, navigate, search, verifyEmailChange]);

  return null;
}
