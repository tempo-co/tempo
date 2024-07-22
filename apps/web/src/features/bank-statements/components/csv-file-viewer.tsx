import Papa from 'papaparse';
import {useEffect, useState} from 'react';

import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';

type CsvRow = {
  [key: string]: string | number;
};

type CsvData = {
  headers: string[];
  records: CsvRow[];
  rowCount: number;
  columnCount: number;
};

type CsvFileViewerProps = {
  file: File;
};

export function CsvFileViewer({file}: CsvFileViewerProps) {
  const [csvData, setCsvData] = useState<CsvData>({
    headers: [],
    records: [],
    rowCount: 0,
    columnCount: 0,
  });

  useEffect(() => {
    if (file) {
      Papa.parse(file, {
        header: true,
        complete: (results) => {
          const rows = results.data as CsvRow[];
          const filteredRows = rows.filter((row) =>
            Object.values(row).some((value) => value !== null && value !== ''),
          );
          const headers = results.meta.fields || [];
          setCsvData({
            headers: headers,
            records: filteredRows,
            rowCount: filteredRows.length,
            columnCount: headers.length,
          });
        },
      });
    }
  }, [file]);

  return (
    <>
      <div className='mb-2 flex justify-end gap-4 text-xs text-muted-foreground'>
        <p>{csvData.columnCount} columns</p>
        <p>{csvData.rowCount} rows</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {csvData.headers.map((header, index) => (
              <TableHead className='p-3' key={index}>
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {csvData.records.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {csvData.headers.map((header, colIndex) => (
                <TableCell className='p-3' key={colIndex}>
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
