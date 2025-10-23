import {Download, EllipsisVertical, FileScan, Trash2} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveMenu,
  ResponsiveMenuContent,
  ResponsiveMenuItem,
  ResponsiveMenuSeparator,
  ResponsiveMenuTrigger,
} from '@/components/ui/responsive-menu';
import {BankStatement} from '@/types/bank-statement';

import {useGetFile} from '../../api/use-get-file';
import {BankStatementDeleteDialog} from '../bank-statement-delete/bank-statement-delete-dialog';
import {FileViewerDialog} from './file-viewer-dialog';

type BankStatementActionsProps = {
  bankStatement: BankStatement;
};

export function BankStatementActions({bankStatement}: BankStatementActionsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFileViewerDialogOpen, setIsFileViewerDialogOpen] = useState(false);

  const {fetchFile, isLoading, setDownloadReady} = useGetFile(bankStatement.file.id);

  const handleDownload = async () => {
    setIsMenuOpen(false);
    await fetchFile();
    setDownloadReady(true);
  };

  const handleView = () => {
    setIsMenuOpen(false);
    setIsFileViewerDialogOpen(true);
  };

  const handleDelete = () => {
    setIsMenuOpen(false);
    setIsDeleteDialogOpen(true);
  };

  return (
    <>
      <FileViewerDialog
        uploadedAt={bankStatement.uploadedAt}
        file={bankStatement.file}
        open={isFileViewerDialogOpen}
        setIsOpen={setIsFileViewerDialogOpen}
      />
      <BankStatementDeleteDialog
        bankStatement={bankStatement}
        isOpen={isDeleteDialogOpen}
        setIsOpen={setIsDeleteDialogOpen}
      />
      <ResponsiveMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <ResponsiveMenuTrigger asChild>
          <Button size='icon' variant='ghost'>
            <EllipsisVertical className='h-4 w-4' />
          </Button>
        </ResponsiveMenuTrigger>
        <ResponsiveMenuContent>
          <ResponsiveMenuItem onClick={handleView}>
            <FileScan className='mr-2 h-4 w-4' />
            <span>View File</span>
          </ResponsiveMenuItem>
          <ResponsiveMenuItem onClick={handleDownload} disabled={isLoading}>
            <Download className='mr-2 h-4 w-4' />
            <span>{isLoading ? 'Downloading...' : 'Download File'}</span>
          </ResponsiveMenuItem>
          <ResponsiveMenuSeparator />
          <ResponsiveMenuItem onClick={handleDelete} className='focus:bg-destructive'>
            <Trash2 className='mr-2 h-4 w-4' />
            <span>Delete Bank Statement</span>
          </ResponsiveMenuItem>
        </ResponsiveMenuContent>
      </ResponsiveMenu>
    </>
  );
}
