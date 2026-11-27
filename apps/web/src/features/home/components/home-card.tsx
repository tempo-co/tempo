import {ArrowDown, ArrowUp, ChevronRight, EyeOff} from 'lucide-react';
import {type ReactElement, type ReactNode, cloneElement} from 'react';

import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {cn} from '@/utils/cn';

/** While customizing: moves within the card's run and hiding; an absent move is at an end of the run. */
export type CardEditing = {
  onUp?: () => void;
  onDown?: () => void;
  onHide: () => void;
};

/**
 * One of Home's cards: a region named `name`, with its heading (`title` when it reads better than the name, such as
 * the month) and a link to the page it summarizes. While customizing, the link gives way to move and hide buttons.
 */
export function HomeCard({
  name,
  title = name,
  link,
  editing,
  className,
  children,
}: {
  name: string;
  title?: ReactNode;
  /** A router link whose text names the page; a chevron follows it. */
  link?: ReactElement<{children?: ReactNode}>;
  editing?: CardEditing;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      role='region'
      aria-label={name}
      className={cn(
        'grid min-w-0 grid-cols-1 content-start gap-3 p-4',
        editing && 'border-dashed',
        className,
      )}
    >
      <header className='-my-2.5 flex min-h-11 items-center justify-between gap-2 sm:min-h-8'>
        <h2 className='min-w-0 truncate text-card-title'>{title}</h2>
        {editing ? (
          <span className='-mr-2 flex shrink-0 items-center'>
            <EditButton label={`Move ${name} up`} onClick={editing.onUp} icon={ArrowUp} />
            <EditButton label={`Move ${name} down`} onClick={editing.onDown} icon={ArrowDown} />
            <EditButton label={`Hide ${name}`} onClick={editing.onHide} icon={EyeOff} />
          </span>
        ) : (
          link && (
            <TextAction asChild className='-mr-2 shrink-0 gap-0.5'>
              {cloneElement(
                link,
                undefined,
                <>
                  {link.props.children} <ChevronRight aria-hidden='true' />
                </>,
              )}
            </TextAction>
          )
        )}
      </header>
      {children}
    </Card>
  );
}

function EditButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick?: () => void;
  icon: typeof ArrowUp;
}) {
  return (
    <Button
      variant='ghost'
      size='icon'
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
      className='size-8 max-sm:size-11 pointer-coarse:size-11'
    >
      <Icon aria-hidden='true' />
    </Button>
  );
}
