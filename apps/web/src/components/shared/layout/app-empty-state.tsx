import * as React from 'react';

type EmptyStateProps = {
  title: string;
  description: string;
  icon: React.ElementType;
  children?: React.ReactNode;
};

export function EmptyState({title, description, icon: Icon, children}: EmptyStateProps) {
  return (
    <div className='flex flex-col items-center rounded-lg border-2 border-dashed bg-card py-20 text-center'>
      <Icon className='mb-6 h-12 w-12 text-muted-foreground' />
      <h2 className='mb-2 text-2xl font-semibold'>{title}</h2>
      <p className='mb-6 max-w-sm text-muted-foreground'>{description}</p>
      {children}
    </div>
  );
}
