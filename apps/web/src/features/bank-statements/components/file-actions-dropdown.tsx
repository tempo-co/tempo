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
import {cn} from '@/utils/cn';

import {useGetFile} from '../api/use-get-file';
import {truncateFileName} from '../utils/truncate-file-name';
import {DeleteBankStatementDialog} from './delete-bank-statement/delete-bank-statement-dialog';
import {FileMetadata} from './file-metadata';
import {FileViewerDialog} from './file-viewer/file-viewer-dialog';

type FileActionsDropdownProps = {
  bankStatement?: BankStatement;
  file?: File;
  isPending?: boolean;
  error?: string | null;
  isSuccess?: boolean;
};

export function FileActionsDropdown({
  bankStatement,
  file,
  isPending,
  error,
  isSuccess,
}: FileActionsDropdownProps) {
  const {accountId} = useParams({
    from: '/(accounts)/(statements)/accounts_/$accountId/bank-statements',
  });

  const [isDropdownMenuOpen, setIsDropdownMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFileViewerDialogOpen, setIsFileViewerDialogOpen] = useState(false);

  const {
    fetchFile,
    file: fetchedFile,
    isLoading,
    setDownloadReady,
  } = useGetFile(accountId, bankStatement?.id || '');

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const handleDownload = async () => {
    setIsDropdownMenuOpen(false);
    await fetchFile();
    setDownloadReady(true);
  };

  return (
    <>
      <FileViewerDialog
        bankStatement={bankStatement}
        file={file || fetchedFile}
        open={isFileViewerDialogOpen}
        setOpen={setIsFileViewerDialogOpen}
        isPending={isPending}
        error={error}
        isSuccess={isSuccess}
      />
      {bankStatement && (
        <DeleteBankStatementDialog
          bankStatement={bankStatement}
          open={isDeleteDialogOpen}
          setOpen={setIsDeleteDialogOpen}
        />
      )}
      {isDesktop ? (
        <DropdownMenu open={isDropdownMenuOpen} onOpenChange={setIsDropdownMenuOpen}>
          {!bankStatement ? (
            <Button size='icon' variant='ghost' onClick={() => setIsFileViewerDialogOpen(true)}>
              <FileScan className='h-4 w-4' />
            </Button>
          ) : (
            <DropdownMenuTrigger asChild>
              <Button size='icon' variant='ghost'>
                <EllipsisVertical className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
          )}
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
            {bankStatement && (
              <>
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
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Drawer open={isDropdownMenuOpen} onOpenChange={setIsDropdownMenuOpen}>
          {!bankStatement ? (
            <Button size='icon' variant='ghost' onClick={() => setIsFileViewerDialogOpen(true)}>
              <FileScan className='h-4 w-4' />
            </Button>
          ) : (
            <DrawerTrigger asChild>
              <Button size='icon' variant='ghost' className='mx-4'>
                <EllipsisVertical className='h-4 w-4' />
              </Button>
            </DrawerTrigger>
          )}
          <DrawerContent aria-describedby='File'>
            <DrawerHeader className='m-5 p-0 text-left'>
              <DrawerTitle className='flex flex-col overflow-hidden p-0 text-base font-normal'>
                {bankStatement && !file && (
                  <>
                    {truncateFileName(bankStatement.file.name)}
                    <FileMetadata
                      fileSize={bankStatement.file.size}
                      fileType={bankStatement.file.type}
                      fileUploadedAt={bankStatement.uploadedAt}
                    />
                  </>
                )}
                {file && (
                  <>
                    {truncateFileName(file.name)}
                    <FileMetadata fileSize={file.size} fileType={file.type} />
                  </>
                )}
              </DrawerTitle>
            </DrawerHeader>
            <Button
              variant='ghost'
              className={cn('mx-1 justify-start', !bankStatement && 'mb-4')}
              onClick={() => setIsFileViewerDialogOpen(true)}
            >
              <FileScan className='mr-2 h-4 w-4' />
              <span>View file</span>
            </Button>
            {bankStatement && (
              <>
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
                  className={cn(
                    'mx-1 justify-start hover:bg-destructive focus:bg-destructive',
                    bankStatement && 'mb-4',
                  )}
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  <span className='mr-1'>Delete Bank Statement</span>
                </Button>
              </>
            )}
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
