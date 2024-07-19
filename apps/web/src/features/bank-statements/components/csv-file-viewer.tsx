import Papa from 'papaparse';
import {useEffect, useState} from 'react';

import {ScrollArea} from '@/components/ui/scroll-area';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';

type CsvRow = {
  [key: string]: string | number;
};

type CsvFileViewerProps = {
  file: File;
};

export function CsvFileViewer({file}: CsvFileViewerProps) {
  const [data, setData] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState<number>(0);
  const [columnCount, setColumnCount] = useState<number>(0);

  useEffect(() => {
    if (file) {
      Papa.parse(file, {
        header: true,
        complete: (results) => {
          const rows = results.data as CsvRow[];
          const filteredRows = rows.filter((row) =>
            Object.values(row).some((value) => value !== null && value !== ''),
          );
          setHeaders(results.meta.fields || []);
          setData(filteredRows);
          setRowCount(filteredRows.length);
          setColumnCount(results.meta.fields ? results.meta.fields.length : 0);
        },
      });
    }
  }, [file]);

  return (
    <>
      <div className='mb-2 flex justify-end gap-4 text-xs text-muted-foreground'>
        <p>{columnCount} columns</p>
        <p>{rowCount} rows</p>
      </div>
      <ScrollArea className='h-full rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead className='p-3' key={index}>
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {headers.map((header, colIndex) => (
                  <TableCell className='p-3' key={colIndex}>
                    {row[header]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </>
  );
}
