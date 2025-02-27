import {read, utils} from 'xlsx';

import {FileData} from '../types/file-data';

export async function parseXls(file: File): Promise<FileData> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = read(arrayBuffer, {type: 'array'});
  const worksheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[worksheetName];

  const records: Record<string, string>[] = utils.sheet_to_json(worksheet, {raw: false});
  const filteredRecords = records.filter((row) =>
    Object.values(row).some((value) => value !== null && value !== ''),
  );
  const headers = Object.keys(records[0] || {});

  return {
    headers,
    records: filteredRecords,
    rowCount: filteredRecords.length,
    columnCount: headers.length,
  };
}
