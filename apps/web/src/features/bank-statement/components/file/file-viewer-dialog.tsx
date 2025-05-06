import {useMemo} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {BankStatement} from '@/types/bank-statement';
import {cn} from '@/utils/cn';

import {FileMetadata} from './file-metadata';
import {FileViewer} from './file-viewer';

type FileViewerDialogProps = {
  open: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  file?: File;
  bankStatement?: BankStatement;
  isPending?: boolean;
  error?: string | null;
  isSuccess?: boolean;
};

export function FileViewerDialog({
  open,
  setIsOpen,
  file,
  bankStatement,
  isPending,
  error,
  isSuccess,
}: FileViewerDialogProps) {
  const {fileName, fileSize, fileType} = useMemo(() => {
    const fileName = file?.name || bankStatement?.file.name;
    const fileSize = file?.size || bankStatement?.file.size;
    const fileType = file?.type || bankStatement?.file.type;

    return {fileName, fileSize, fileType};
  }, [file, bankStatement]);

  return (
    <ResponsiveDialog open={open} onOpenChange={setIsOpen}>
      <ResponsiveDialogContent
        className={cn('h-[80%] gap-0 px-4 md:max-w-[70%]', error && 'border-destructive')}
      >
        <ResponsiveDialogHeader className='min-w-0 px-0 text-start'>
          <ResponsiveDialogTitle className='quotes-none w-full truncate pr-10'>
            {fileName}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {fileSize && fileType && (
              <FileMetadata
                fileSize={fileSize}
                fileType={fileType}
                fileUploadedAt={bankStatement?.uploadedAt}
                isPending={isPending}
                error={error}
                isSuccess={isSuccess}
              />
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <FileViewer file={file} bankStatementId={bankStatement?.id} />
        <ResponsiveDialogFooter className='px-0'>
          <ResponsiveDialogClose asChild>
            <Button type='button' variant='outline' className='mt-4 w-full'>
              Close
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
