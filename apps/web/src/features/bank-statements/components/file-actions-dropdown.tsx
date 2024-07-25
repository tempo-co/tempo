import {Download, FileScan} from 'lucide-react';
import {ReactNode, useState} from 'react';

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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useMediaQuery} from '@/hooks/use-media-query';
import {File} from '@/types/file';

import {truncateFileName} from '../utils/truncate-file-name';

type FileActionsDropdownProps = {
  fileName: File['name'];
  children?: ReactNode;
};

export function FileActionsDropdown({fileName, children}: FileActionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='group flex h-fit w-full justify-start'>
            {children}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-[--radix-dropdown-menu-trigger-width]'>
          <DropdownMenuItem>
            <FileScan className='mr-2 h-4 w-4' />
            <span>View file</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Download className='mr-2 h-4 w-4' />
            <span>Download file</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant='ghost' className='group flex h-fit w-full justify-start'>
          {children}
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby='File'>
        <DrawerHeader className='text-left'>
          <DrawerHeader className='mx-1 p-0 text-left'>
            <DrawerTitle className='p-0 text-base'>{truncateFileName(fileName)}</DrawerTitle>
          </DrawerHeader>
        </DrawerHeader>
        <Button variant='ghost' className='mx-1 mb-1 justify-start'>
          <FileScan className='mr-2 h-4 w-4' />
          <span>View file</span>
        </Button>
        <Button variant='ghost' className='mx-1 mb-4 justify-start'>
          <Download className='mr-2 h-4 w-4' />
          <span>Download file</span>
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
