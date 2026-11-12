import {format, isToday} from 'date-fns';
import {CloudOff, RotateCw, WifiOff} from 'lucide-react';
import * as React from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {HttpError, NetworkError} from '@/utils/api';
import {cn} from '@/utils/cn';

type StateMessageProps = {
  /** `error` marks a failed load: the tile takes the destructive colour. */
  tone?: 'empty' | 'error';
  /** `page` replaces a list or page and is its own card; `section` sits inside a card or dialog. */
  size?: 'page' | 'section';
  icon: React.ElementType;
  title: string;
  description: React.ReactNode;
  /** One quiet technical line, such as a status code and the time it failed. */
  detail?: string;
  /** The title's heading level; a page's only state is its `h1`. */
  titleAs?: 'h1' | 'h2' | 'h3';
  /** A list's first run: static rows in the list's row shape under the message. */
  previewRows?: boolean;
  className?: string;
  children?: React.ReactNode;
};

/** The empty, not-found and failed-load state: a round tile, a title, a muted description and the next action. */
export function StateMessage({
  tone = 'empty',
  size = 'page',
  icon: Icon,
  title,
  description,
  detail,
  titleAs,
  previewRows = false,
  className,
  children,
}: StateMessageProps) {
  const Title = titleAs ?? (size === 'page' ? 'h2' : 'h3');
  const body = (
    <div className='flex items-start gap-4'>
      <span
        aria-hidden='true'
        className={cn(
          'grid shrink-0 place-items-center rounded-full border',
          size === 'page' ? 'size-10 [&_svg]:size-5' : 'size-9 [&_svg]:size-[18px]',
          tone === 'error'
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink',
        )}
      >
        <Icon strokeWidth={2} />
      </span>
      <div className='min-w-0 flex-1 pt-0.5'>
        <Title
          className={cn(
            'text-balance',
            size === 'page' ? 'text-card-title' : 'text-sm leading-snug font-medium',
          )}
        >
          {title}
        </Title>
        <p className='mt-1 max-w-[60ch] text-sm text-pretty break-words text-muted-foreground'>
          {description}
        </p>
        {detail ? (
          <p className='mt-2 font-mono text-label text-muted-foreground'>{detail}</p>
        ) : null}
        {children ? <div className='mt-4 flex flex-wrap gap-2'>{children}</div> : null}
      </div>
    </div>
  );

  if (size === 'section') return <div className={cn('py-2', className)}>{body}</div>;
  return (
    <Card className={cn('overflow-hidden p-5 sm:p-6', previewRows && 'pb-0 sm:pb-0', className)}>
      {body}
      {previewRows ? <PreviewRows /> : null}
    </Card>
  );
}

/** Three still rows in the 60px transaction-row shape, fading out; they never pulse, so they don't read as loading. */
function PreviewRows() {
  return (
    <div
      aria-hidden='true'
      className='-mx-5 mt-6 border-t [mask-image:linear-gradient(to_bottom,black_30%,transparent)] sm:-mx-6'
    >
      {[62, 48, 55].map((width) => (
        <div
          key={width}
          className='flex h-[60px] items-center gap-3 border-b px-5 last:border-b-0 sm:px-6'
        >
          <span className='size-9 shrink-0 rounded-full border border-dashed border-muted-foreground/40' />
          <span className='grid flex-1 gap-1.5'>
            <span className='h-2.5 rounded-full bg-muted' style={{width: `${width * 0.6}%`}} />
            <span className='h-2 rounded-full bg-muted/70' style={{width: `${width * 0.3}%`}} />
          </span>
          <span className='h-2.5 w-14 rounded-full bg-muted' />
        </div>
      ))}
    </div>
  );
}

const failedAtLabel = (time: number) => format(time, isToday(time) ? 'HH:mm' : 'd MMM, HH:mm');

/** What a failed load says about its cause: offline, no answer, or an error reply. */
function describeFailure(error: unknown) {
  if (!navigator.onLine)
    return {
      offline: true,
      icon: WifiOff,
      description: 'This loads once the device is back online.',
      code: null,
    } as const;
  // A request without a reply, or one paused until the server answers again.
  if (error instanceof NetworkError || error == null)
    return {
      offline: false,
      icon: CloudOff,
      description: "The server can't be reached right now.",
      code: 'No response',
    } as const;
  if (error instanceof HttpError)
    return {
      offline: false,
      icon: CloudOff,
      description:
        error.status >= 500
          ? 'The server ran into a problem.'
          : error.status === 429
            ? 'Too many requests for now. Wait a moment.'
            : 'The server turned the request down.',
      code: String(error.status),
    } as const;
  return {
    offline: false,
    icon: CloudOff,
    description: 'Something went wrong while loading.',
    code: null,
  } as const;
}

type LoadErrorStateProps = {
  title: string;
  /** The failed query's error; it picks the description and the status code. */
  error: unknown;
  onRetry: () => unknown;
  size?: StateMessageProps['size'];
  className?: string;
  /** Actions after Try again, such as Clear filters. */
  children?: React.ReactNode;
};

/** A load that failed with nothing saved to show: why, when, and Try again with its pending state. */
export function LoadErrorState({
  title,
  error,
  onRetry,
  size = 'page',
  className,
  children,
}: LoadErrorStateProps) {
  const [failedAt, setFailedAt] = React.useState(() => Date.now());
  const [isRetrying, setIsRetrying] = React.useState(false);
  const failure = describeFailure(error);

  const retry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
      setFailedAt(Date.now());
    }
  };

  return (
    <div role='alert' className={className}>
      <StateMessage
        tone='error'
        size={size}
        icon={failure.icon}
        title={failure.offline ? "You're offline" : title}
        description={failure.description}
        detail={failure.code ? `${failure.code} · ${failedAtLabel(failedAt)}` : undefined}
      >
        <Button
          variant='outline'
          size={size === 'section' ? 'sm' : 'default'}
          disabled={isRetrying}
          onClick={() => void retry()}
        >
          {isRetrying ? (
            <PendingLabel>Trying again…</PendingLabel>
          ) : (
            <>
              <RotateCw aria-hidden='true' />
              Try again
            </>
          )}
        </Button>
        {children}
      </StateMessage>
    </div>
  );
}
