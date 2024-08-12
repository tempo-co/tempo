import {useParams} from '@tanstack/react-router';
import {Download, EllipsisVertical, FileScan, Trash2} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Separator} from '@/components/ui/separator';
import {useMediaQuery} from '@/hooks/use-media-query';
import {BankStatement} from '@/types/bank-statement';

import {useGetFile} from '../api/use-get-file';
import {truncateFileName} from '../utils/truncate-file-name';
import {DeleteBankStatementDialog} from './delete-bank-statement/delete-bank-statement-dialog';
import {FileMetadata} from './file-metadata';
import {FileViewerDialog} from './file-viewer-dialog';

type FileActionsDropdownProps = {
  bankStatement: BankStatement;
};

export function FileActionsDropdown({bankStatement}: FileActionsDropdownProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const [isDropdownMenuOpen, setIsDropdownMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFileViewerDialogOpen, setIsFileViewerDialogOpen] = useState(false);

  const {fetchFile, file, isLoading, setDownloadReady} = useGetFile(accountId, bankStatement.id);

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const handleDownload = async () => {
    setIsDropdownMenuOpen(false);
    await fetchFile();
    setDownloadReady(true);
  };

  return (
    <>
      <FileViewerDialog
        fileUploadedAt={bankStatement.uploadedAt}
        bankStatement={bankStatement}
        file={file}
        open={isFileViewerDialogOpen}
        setOpen={setIsFileViewerDialogOpen}
      />
      <DeleteBankStatementDialog
        bankStatement={bankStatement}
        open={isDeleteDialogOpen}
        setOpen={setIsDeleteDialogOpen}
      />
      {isDesktop ? (
        <DropdownMenu open={isDropdownMenuOpen} onOpenChange={setIsDropdownMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button size='icon' variant='ghost' className='mx-4'>
              <EllipsisVertical className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              className='p-0 focus:cursor-pointer'
              onClick={() => setIsFileViewerDialogOpen(true)}
            >
              <div className='flex h-full w-full items-center px-2 py-1.5'>
                <FileScan className='mr-2 h-4 w-4' />
                <span>View File</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className='focus:cursor-pointer'
              disabled={isLoading}
              onClick={handleDownload}
            >
              <Download className='mr-2 h-4 w-4' />
              <span>{isLoading ? 'Downloading...' : 'Download File'}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='p-0 focus:cursor-pointer focus:bg-destructive'
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <div className='flex h-full w-full items-center px-2 py-1.5'>
                <Trash2 className='mr-2 h-4 w-4' />
                <span className='mr-1'>Delete Bank Statement</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Drawer open={isDropdownMenuOpen} onOpenChange={setIsDropdownMenuOpen}>
          <DrawerTrigger asChild>
            <Button size='icon' variant='ghost' className='mx-4'>
              <EllipsisVertical className='h-4 w-4' />
            </Button>
          </DrawerTrigger>
          <DrawerContent aria-describedby='File'>
            <DrawerHeader className='text-left'>
              <DrawerHeader className='mx-1 p-0 text-left'>
                <DrawerTitle className='flex flex-col p-0 text-base font-normal'>
                  {truncateFileName(bankStatement.file.name)}
                  <FileMetadata
                    fileSize={bankStatement.file.size}
                    fileType={bankStatement.file.type}
                    fileUploadedAt={bankStatement.uploadedAt}
                  />
                </DrawerTitle>
              </DrawerHeader>
            </DrawerHeader>
            <Button
              variant='ghost'
              className='mx-1 justify-start'
              onClick={() => setIsFileViewerDialogOpen(true)}
            >
              <FileScan className='mr-2 h-4 w-4' />
              <span>View file</span>
            </Button>
            <Button
              variant='ghost'
              className='mx-1 justify-start'
              onClick={handleDownload}
              disabled={isLoading}
            >
              <Download className='mr-2 h-4 w-4' />
              <span>{isLoading ? 'Downloading...' : 'Download File'}</span>
            </Button>
            <Separator className='mx-4 my-1 w-auto' />
            <Button
              variant='ghost'
              className='mx-1 mb-4 justify-start hover:bg-destructive focus:bg-destructive'
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <Trash2 className='mr-2 h-4 w-4' />
              <span className='mr-1'>Delete Bank Statement</span>
            </Button>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
