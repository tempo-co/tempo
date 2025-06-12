import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {ResetPasswordRequest} from '@/features/auth/components/reset-password/reset-password-request';
import {ResetPasswordVerify} from '@/features/auth/components/reset-password/reset-password-verify';
import {passwordResetSearchParamsSchema} from '@/features/auth/types/token.dto';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordIndex,
  validateSearch: zodValidator(passwordResetSearchParamsSchema),
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function ResetPasswordIndex() {
  const {token, email} = Route.useSearch();

  if (token && email) {
    return <ResetPasswordVerify token={token} email={email} />;
  }
  return <ResetPasswordRequest />;
}
