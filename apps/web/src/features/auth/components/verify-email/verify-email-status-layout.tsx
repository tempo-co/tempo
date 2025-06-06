import * as React from 'react';

import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

type VerifyEmailStatusLayoutProps = {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  maxWidth?: string;
};

export function VerifyEmailStatusLayout({
  icon,
  title,
  description,
  action,
  maxWidth = 'max-w-[28rem]',
}: VerifyEmailStatusLayoutProps) {
  return (
    <div className='flex h-screen w-screen items-center justify-center bg-background'>
      <div className={cn('flex flex-col items-center space-y-4 text-center', maxWidth)}>
        {icon}
        <p className='text-2xl font-medium text-foreground'>{title}</p>
        {description && <p className='text-muted-foreground'>{description}</p>}
        {action && (
          <Button variant='link' asChild className='!mt-6'>
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
