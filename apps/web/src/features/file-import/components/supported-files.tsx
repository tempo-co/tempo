import type {BankImportLayout} from '@tempo/contracts';
import {useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {wasToasted} from '@/utils/api';

import {useBankImportLayouts, useRemoveLayout} from '../api/use-layout-proposals';
import {formatImportedDay} from '../utils/import-format';
import {BANK_EXPORTS, STANDARD_FORMATS} from '../utils/supported-files';

export const SUPPORTED_FILES = 'Supported files';

/** A Supported files text action, and the dialog it opens listing the formats and bank exports the import reads. */
export function SupportedFiles() {
  const [open, setOpen] = useState(false);
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      {/* The trigger takes focus back when the dialog closes. */}
      <ResponsiveDialogTrigger asChild>
        <TextAction type='button' className='-ml-2'>
          {SUPPORTED_FILES}
        </TextAction>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent data-testid='supported-files'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>{SUPPORTED_FILES}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Export a statement from your bank in one of these. Several files or a zip at once work
            too.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div className='grid grid-cols-1 gap-4 pb-4 text-sm md:pb-0'>
            <section aria-labelledby='supported-files-standard' className='grid gap-1'>
              <h3 id='supported-files-standard' className='font-medium'>
                Standard formats
              </h3>
              <p className='text-muted-foreground'>{STANDARD_FORMATS.join(', ')}</p>
            </section>
            <section aria-labelledby='supported-files-banks' className='grid gap-1'>
              <h3 id='supported-files-banks' className='font-medium'>
                Bank exports
              </h3>
              <ul aria-labelledby='supported-files-banks' className='grid gap-1'>
                {BANK_EXPORTS.map(({bank, files}) => (
                  <li key={bank} className='flex justify-between gap-3'>
                    <span>{bank}</span>
                    <span className='text-muted-foreground'>{files}</span>
                  </li>
                ))}
              </ul>
            </section>
            <YourLayouts enabled={open} />
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * The layouts the owner confirmed for files Tempo did not know, each with Remove; shown once there is one. Removing
 * one leaves what it imported; Undo on the import removes that.
 */
function YourLayouts({enabled}: {enabled: boolean}) {
  const {data: layouts} = useBankImportLayouts(enabled);
  if (!layouts || layouts.length === 0) return null;
  return (
    <section aria-labelledby='supported-files-yours' className='grid gap-1'>
      <h3 id='supported-files-yours' className='font-medium'>
        Your layouts
      </h3>
      <ul aria-labelledby='supported-files-yours' className='grid gap-1'>
        {layouts.map((layout) => (
          <LayoutRow key={layout.id} layout={layout} />
        ))}
      </ul>
    </section>
  );
}

/** `today`, `yesterday` or a date, as a row's second line reads. */
function addedDay(createdAt: string) {
  const day = formatImportedDay(createdAt);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
}

function LayoutRow({layout}: {layout: BankImportLayout}) {
  const {removeLayout} = useRemoveLayout();
  const [pending, setPending] = useState(false);
  const remove = async () => {
    setPending(true);
    try {
      await removeLayout(layout.id);
    } catch (error) {
      setPending(false);
      if (wasToasted(error)) return;
      toast.error(`Couldn't remove ${layout.bankName}`, {
        description: 'Please try again in a moment.',
        id: `bank-import-layout-remove-failed-${layout.id}`,
      });
    }
  };
  return (
    <li className='flex min-h-11 items-center justify-between gap-3'>
      <span className='min-w-0'>
        <span className='block truncate'>{layout.bankName}</span>
        <span className='block text-xs text-muted-foreground'>
          Added {addedDay(layout.createdAt)}
        </span>
      </span>
      <Button
        variant='ghost'
        size='sm'
        disabled={pending}
        aria-label={`Remove ${layout.bankName}`}
        onClick={() => void remove()}
        className='-mr-2 shrink-0'
      >
        {pending ? <PendingLabel>Removing…</PendingLabel> : 'Remove'}
      </Button>
    </li>
  );
}
