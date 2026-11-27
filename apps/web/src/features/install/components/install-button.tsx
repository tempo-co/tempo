import {Share, SquarePlus} from 'lucide-react';
import {type ReactNode, type RefObject, useRef, useState} from 'react';

import {Button, type ButtonProps} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {promptInstall} from '@/utils/installed-app';

import type {InstallWay} from '../use-install';

/**
 * Installs Tempo the way this device allows: Chrome's own install dialog, or on iPhone and iPad the Share › Add to
 * Home Screen steps. Renders nothing where neither applies.
 */
export function InstallButton({
  way,
  children,
  ...props
}: {way: InstallWay; children: ReactNode} & Omit<ButtonProps, 'onClick'>) {
  const [steps, setSteps] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  if (way !== 'steps' && way !== 'prompt') return null;
  return (
    <>
      <Button
        {...props}
        onClick={(event) => {
          if (way === 'prompt') return void promptInstall();
          openerRef.current = event.currentTarget;
          setSteps(true);
        }}
      >
        {children}
      </Button>
      {way === 'steps' && (
        <HomeScreenSteps open={steps} onOpenChange={setSteps} openerRef={openerRef} />
      )}
    </>
  );
}

const SAFARI_CONTROL =
  'inline-flex items-center gap-1 rounded-md border px-1.5 font-medium [&_svg]:size-3.5';

/** Safari's steps to add Tempo to the Home Screen, which no page can do for the owner. */
function HomeScreenSteps({
  open,
  onOpenChange,
  openerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  const steps: ReactNode[] = [
    <>
      Tap{' '}
      <span className={SAFARI_CONTROL}>
        <Share aria-hidden='true' />
        Share
      </span>{' '}
      in Safari’s toolbar
    </>,
    <>
      Scroll and tap{' '}
      <span className={SAFARI_CONTROL}>
        <SquarePlus aria-hidden='true' />
        Add to Home Screen
      </span>
    </>,
    <>
      Tap <span className='font-medium'>Add</span>. Tempo then opens from its own icon.
    </>,
  ];
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        onCloseAutoFocus={(event) => {
          if (!openerRef.current?.isConnected) return;
          event.preventDefault();
          openerRef.current.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add Tempo to your Home Screen</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            It opens full screen, like an app.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className='grid gap-3'>
          <ol className='grid gap-3'>
            {steps.map((step, index) => (
              <li key={index} className='flex items-center gap-3 text-body'>
                <span
                  aria-hidden='true'
                  className='grid size-6 shrink-0 place-items-center rounded-full bg-muted text-label font-semibold'
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className='text-body-small text-muted-foreground'>
            iPhone allows this from Safari. Using another browser? Open Tempo in Safari.
          </p>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
