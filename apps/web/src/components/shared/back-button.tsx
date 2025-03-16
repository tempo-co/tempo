import {useCanGoBack, useRouter} from '@tanstack/react-router';
import {ChevronLeft} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

type BackButtonProps = {
  className?: string;
};

export function BackButton({className}: BackButtonProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  if (canGoBack) {
    return (
      <Button
        variant='link'
        onClick={() => router.history.back()}
        className={cn('-ml-4 text-foreground', className)}
      >
        <ChevronLeft />
        Back
      </Button>
    );
  }
}
