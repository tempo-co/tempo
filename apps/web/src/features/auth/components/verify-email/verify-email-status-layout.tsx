import * as React from 'react';

import {AlertDialog, AlertDialogContent} from '@/components/ui/alert-dialog';
import {cn} from '@/utils/cn';

import {Flow} from '../../types/flow';

type VerifyEmailStatusLayoutProps = {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  maxWidth?: string;
  flow?: Flow;
};

export function VerifyEmailStatusLayout({
  icon,
  title,
  description,
  action,
  maxWidth = 'max-w-[28rem]',
  flow = 'onboarding',
}: VerifyEmailStatusLayoutProps) {
  const content = (
    <div className={cn('flex flex-col items-center space-y-4 text-center', maxWidth)}>
      {icon}
      <p className='text-2xl font-medium text-foreground'>{title}</p>
      {description && <p className='text-muted-foreground'>{description}</p>}
      {action && <div className='mt-4'>{action}</div>}
    </div>
  );

  if (flow === 'email-change') {
    return (
      <AlertDialog open>
        <AlertDialogContent className='flex h-64 items-center justify-center'>
          {content}
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <div className='flex h-screen w-screen items-center justify-center bg-background'>
      {content}
    </div>
  );
}
