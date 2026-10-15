import {ReactNode} from 'react';

type SettingsGroupProps = {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

/** A titled settings group: a small heading, and optional one-line context. */
export function SettingsGroup({id, title, description, children}: SettingsGroupProps) {
  return (
    <section aria-labelledby={id}>
      <div className='mb-3 flex items-end justify-between gap-3'>
        <div className='min-w-0'>
          <h2 id={id} className='text-card-title'>
            {title}
          </h2>
          {description && <p className='mt-1 text-sm text-muted-foreground'>{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Rows of one group share a single bordered surface, the same pattern as bank account lists. */
export function SettingsList({children}: {children: ReactNode}) {
  return <div className='divide-y rounded-card border bg-card'>{children}</div>;
}

type SettingsRowProps = {
  label: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
};

export function SettingsRow({label, value, action}: SettingsRowProps) {
  return (
    <div className='flex min-h-16 items-center justify-between gap-4 px-4 py-3'>
      <div className='min-w-0'>
        <p className='text-sm font-medium'>{label}</p>
        {value && <p className='mt-0.5 text-sm wrap-break-word text-muted-foreground'>{value}</p>}
      </div>
      {action && <div className='shrink-0'>{action}</div>}
    </div>
  );
}
