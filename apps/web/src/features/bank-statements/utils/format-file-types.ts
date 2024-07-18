import {FileTypes} from '../types/file-types';

export function formatSupportedFileTypes(fileTypes: typeof FileTypes): string {
  const supportedFileTypesArray = Object.keys(fileTypes);
  const lastFileType = supportedFileTypesArray.pop();
  return `${supportedFileTypesArray.join(', ').toUpperCase()} and ${lastFileType?.toUpperCase()}`;
}
