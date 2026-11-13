/**
 * Upload and parse limits for one drop. The parse runner and the upload route both read them, so this file imports
 * nothing: the parse child loads it alone. The web mirrors the first three to refuse a choice before uploading it.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_DROP = 20;
/** The drop's files together. */
export const MAX_DROP_BYTES = 25 * 1024 * 1024;
/**
 * The multipart framing around a drop's files: a boundary and headers naming each file, and the two short text
 * fields. An upload is refused once its body is larger than `MAX_DROP_BYTES` plus this.
 */
export const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;
export const MAX_ARCHIVE_UNPACKED_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ROWS_PER_DROP = 20_000;
