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
import {FileEntity} from '@/types/file';

import {FileMetadata} from './file-metadata';
import {FileViewer} from './file-viewer';

type FileViewerDialogProps = {
  open: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  file: FileEntity;
  uploadedAt: BankStatement['uploadedAt'];
};

export function FileViewerDialog({open, setIsOpen, file, uploadedAt}: FileViewerDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={setIsOpen}>
      <ResponsiveDialogContent className='h-[80%] gap-0 px-4 md:max-w-[70%]'>
        <ResponsiveDialogHeader className='min-w-0 px-0 text-start'>
          <ResponsiveDialogTitle className='quotes-none w-full truncate pr-10'>
            {file.name}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            <FileMetadata
              fileSize={file.size}
              fileType={file.mimeType}
              fileUploadedAt={uploadedAt}
            />
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <FileViewer fileId={file.id} />
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
