import {extension} from 'mime-types';

/** Extracts the filename and MIME type from HTTP response headers. */
export function extractFileMetadata(headers: Headers) {
  // Extract filename from Content-Disposition header
  const contentDisposition = headers.get('Content-Disposition');
  let fileName = 'file';
  if (contentDisposition) {
    const matches = contentDisposition.match(/filename\*?=(?:(?:UTF-8'')?([^;]+)|"([^"]+)")/i);
    if (matches) {
      fileName = decodeURIComponent((matches[1] || matches[2] || 'file').trim());
    }
  }

  // Determine MIME type from Content-Type header
  let mimeType = headers.get('Content-Type') || 'application/octet-stream';
  mimeType = mimeType.split(';')[0].trim();

  // Append file extension if missing
  if (!fileName.includes('.')) {
    const fileExtension = extension(mimeType) || 'bin';
    fileName = `${fileName}.${fileExtension}`;
  }

  return {fileName, mimeType};
}
