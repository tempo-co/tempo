import {ColumnDef} from '@tanstack/react-table';
import {ArrowUpDown} from 'lucide-react';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Button} from '@/components/ui/button';
import {BankStatement} from '@/types/bank-statement';

import {formatPeriod} from '../../utils/format-period';
import {FileActionsDropdown} from '../file/file-actions-dropdown';
import {FileMetadata} from '../file/file-metadata';

export const bankStatementTableColumns: ColumnDef<BankStatement>[] = [
  {
    accessorKey: 'file.name',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='flex h-12 w-full justify-start px-4'
        >
          <span>File</span>
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return (
        <div className='flex items-center px-3 py-2'>
          <div className='mr-3 rounded-md bg-muted p-2'>
            <MimeTypeIcon mimeType={row.original.file.mimeType} />
          </div>
          <div className='overflow-hidden'>
            <p className='mb-1 max-w-full text-base text-foreground'>{row.original.file.name}</p>
            <FileMetadata
              fileSize={row.original.file.size}
              fileType={row.original.file.mimeType}
              fileUploadedAt={row.original.uploadedAt}
            />
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: 'period',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='-m-4 flex h-12 justify-start px-4'
        >
          <span>Period</span>
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return <p className='whitespace-nowrap'>{formatPeriod(row.original.period)}</p>;
    },
  },
  {
    id: 'actions',
    cell: ({row}) => {
      return (
        <div className='mx-4 flex justify-end'>
          <FileActionsDropdown bankStatement={row.original} />
        </div>
      );
    },
  },
];
