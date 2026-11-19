import {VariantProps} from 'class-variance-authority';
import {useEffect, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button, buttonVariants} from '@/components/ui/button';
import {cn} from '@/utils/cn';

import {useResendVerificationEmail} from '../api/use-resend-verification-email';

type ResendCodeButton = {
  variant?: VariantProps<typeof buttonVariants>['variant'];
  className?: string;
  onSuccess?: () => void;
};

export function ResendCodeButton({variant = 'ghost', className, onSuccess}: ResendCodeButton) {
  const {resendVerificationEmail, isPending} = useResendVerificationEmail();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (cooldown > 0) {
      interval = setInterval(() => {
        setCooldown((prevCooldown) => prevCooldown - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [cooldown]);

  const handleResendClick = async () => {
    // A failure has already been toasted; the button stays ready for another try.
    const result = await resendVerificationEmail({onSuccess}).catch(() => null);
    if (result === 'sent') setCooldown(60);
  };

  const isDisabled = isPending || cooldown > 0;

  return (
    <Button
      className={cn('w-full whitespace-normal', className)}
      type='button'
      variant={variant}
      onClick={handleResendClick}
      disabled={isDisabled}
      data-testid='resend-code-button'
    >
      {isPending ? (
        <PendingLabel>Sending new verification email...</PendingLabel>
      ) : cooldown > 0 ? (
        <span>Resend in {cooldown}s</span>
      ) : (
        <span>Send new verification email</span>
      )}
    </Button>
  );
}
