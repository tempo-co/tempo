import {FileWarning} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/utils/cn';

import {FileData} from '../types/file-data';
import {parseFile} from '../utils/parse-file';

type FileViewerProps = {
  file: File;
  isDesktop?: boolean;
};

export function FileViewer({file, isDesktop}: FileViewerProps) {
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<FileData>({
    headers: [],
    records: [],
    rowCount: 0,
    columnCount: 0,
  });

  useEffect(() => {
    async function fetchData() {
      const data = await parseFile(file);
      setData(data);
    }
    fetchData().catch(setError);
  }, [file, setError]);

  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center text-center text-destructive',
          isDesktop !== undefined && !isDesktop && 'mt-20',
        )}
      >
        <FileWarning className='mb-2 h-14 w-14 text-destructive' />
        <p>An error occurred while parsing this file.</p>
        <p>Please check its contents and try again.</p>
      </div>
    );
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
