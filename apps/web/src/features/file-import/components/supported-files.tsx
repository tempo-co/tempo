import {TextAction} from '@/components/shared/text-action';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {BANK_EXPORTS, STANDARD_FORMATS} from '../utils/supported-files';

export const SUPPORTED_FILES = 'Supported files';

/** A Supported files text action, and the dialog it opens listing the formats and bank exports the import reads. */
export function SupportedFiles() {
  return (
    <ResponsiveDialog>
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
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
