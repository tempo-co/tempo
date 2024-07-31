import {ColumnDef} from '@tanstack/react-table';
import {ArrowUpDown, ChevronDown} from 'lucide-react';
import prettyBytes from 'pretty-bytes';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Button} from '@/components/ui/button';
import {BankStatement} from '@/types/bank-statement';
import {getMimeTypeKey} from '@/types/file';

import {formatPeriod} from '../utils/format-period';
import {DeleteBankStatementDialog} from './delete-bank-statement-dialog';
import {FileActionsDropdown} from './file-actions-dropdown';

export const bankStatementsTableColumns: ColumnDef<BankStatement>[] = [
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
        <FileActionsDropdown fileName={row.original.file.name}>
          <div className='flex items-center'>
            <div className='mr-4 rounded-md bg-muted p-2'>
              <MimeTypeIcon mimeType={row.original.file.mimeType} />
            </div>
            <div className='text-left'>
              <p className='mb-1 max-w-full text-base text-foreground'>{row.original.file.name}</p>
              <span className='mt-1 whitespace-nowrap text-sm text-muted-foreground'>
                <span>{getMimeTypeKey(row.original.file.mimeType)}</span>
                <span className='mx-3'>•</span>
                <span>{prettyBytes(Number(row.original.file.size))}</span>
              </span>
            </div>
          </div>
          <ChevronDown className='invisible ml-4 w-4 group-hover:visible' />
        </FileActionsDropdown>
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
      return <p>{formatPeriod(row.original.period)}</p>;
    },
  },
  {
    id: 'actions',
    cell: ({row}) => {
      return <DeleteBankStatementDialog bankStatement={row.original} />;
    },
  },
];
