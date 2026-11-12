/** Upload and parse limits for one drop. The parse runner and the upload route both read them. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_DROP = 20;
export const MAX_ARCHIVE_UNPACKED_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ROWS_PER_DROP = 50_000;
