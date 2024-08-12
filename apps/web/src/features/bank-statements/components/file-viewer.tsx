import {useParams} from '@tanstack/react-router';
import {FileWarning} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Skeleton} from '@/components/ui/skeleton';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {useMediaQuery} from '@/hooks/use-media-query';
import {BankStatement} from '@/types/bank-statement';
import {cn} from '@/utils/cn';

import {useGetFile} from '../api/use-get-file';
import {FileData} from '../types/file-data';
import {parseFile} from '../utils/parse-file';

type FileViewerProps = {
  file?: File;
  bankStatementId?: BankStatement['id'];
};

export function FileViewer({file, bankStatementId}: FileViewerProps) {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<FileData>({
    headers: [],
    records: [],
    rowCount: 0,
    columnCount: 0,
  });

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {fetchFile, file: fetchedFile, isLoading} = useGetFile(accountId, bankStatementId || '');

  useEffect(() => {
    async function fetchData() {
      if (file) {
        const data = await parseFile(file);
        setData(data);
      } else {
        await fetchFile();
        if (fetchedFile) {
          const data = await parseFile(fetchedFile);
          setData(data);
        }
      }
    }
    fetchData().catch(setError);
  }, [file, fetchFile, fetchedFile]);

  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center text-center text-destructive',
          !isDesktop && 'mt-20',
        )}
      >
        <FileWarning className='mb-2 h-14 w-14 text-destructive' />
        <p>An error occurred while parsing this file.</p>
        <p>Please check its contents and try again.</p>
      </div>
    );
  }

  if (isLoading) {
    const skeletonLoader = Array.from({length: 10}, (_, index) => (
      <Skeleton key={index} className='mt-4 h-10' />
    ));
    return <>{skeletonLoader}</>;
  }

  return (
    <>
      <div className='mb-2 flex justify-end gap-4 text-xs text-muted-foreground'>
        <p>{data.columnCount} columns</p>
        <p>{data.rowCount} rows</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {data.headers.map((header, index) => (
              <TableHead className='p-2 md:p-3' key={index}>
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody verticalScrollBarClassName='pt-[2.4rem] md:pt-[2.9rem]'>
          {data.records.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {data.headers.map((header, colIndex) => (
                <TableCell className='p-2 md:p-3' key={colIndex}>
                  {row[header]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
