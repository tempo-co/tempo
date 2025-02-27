import Papa from 'papaparse';

import {FileData} from '../types/file-data';

type ParseResult = Papa.ParseResult<Record<string, string>>;

export async function parseCsv(file: File): Promise<FileData> {
  const result = await new Promise<ParseResult>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: resolve,
      error: reject,
    });
  });

  const records = result.data;
  const filteredRecords = records.filter((row) =>
    Object.values(row).some((value) => value !== null && value !== ''),
  );
  const headers = result.meta.fields || [];

  return {
    headers,
    records: filteredRecords,
    rowCount: filteredRecords.length,
    columnCount: headers.length,
  };
}
