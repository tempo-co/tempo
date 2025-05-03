import {Loader} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';

import {useResendVerificationEmail} from '../api/use-resend-verification-email';

export function ResendCodeButton() {
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
    await resendVerificationEmail();
    setCooldown(60);
  };

  const isDisabled = isPending || cooldown > 0;

  return (
    <Button
      className='w-full'
      type='button'
      variant='ghost'
      onClick={handleResendClick}
      disabled={isDisabled}
    >
      {isPending ? (
        <>
          <span>Sending new code...</span>
          <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
        </>
      ) : cooldown > 0 ? (
        <span>Resend in {cooldown}s</span>
      ) : (
        <span>Send new code</span>
      )}
    </Button>
  );
}
