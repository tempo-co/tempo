import {MimeType} from '@/types/file';

import {FileData} from '../types/file-data';
import {parseCsv} from './parse-csv';
import {parseXls} from './parse-xls';

type FileParser = (file: File) => Promise<FileData>;

const parsers: Record<MimeType, FileParser> = {
  [MimeType.CSV]: parseCsv,
  [MimeType.XLS]: parseXls,
  [MimeType.XLSX]: parseXls,
};

export function parseFile(file: File) {
  const parser = parsers[file.type as MimeType];
  return parser(file);
}
