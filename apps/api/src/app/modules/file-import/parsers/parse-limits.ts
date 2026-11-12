import {BANK_IMPORT_MAX_DROP_BYTES, BANK_IMPORT_MAX_FILES, BANK_IMPORT_MAX_FILE_BYTES} from '@tempo/contracts';

/**
 * Upload and parse limits for one drop. The parse runner and the upload route both read them; the three a person
 * can run into come from the contracts, so the web refuses the same choice before uploading it.
 */
export const MAX_FILE_BYTES = BANK_IMPORT_MAX_FILE_BYTES;
export const MAX_FILES_PER_DROP = BANK_IMPORT_MAX_FILES;
/** The drop's files together: 25 MB. */
export const MAX_DROP_BYTES = BANK_IMPORT_MAX_DROP_BYTES;
/**
 * The multipart framing around a drop's files: a boundary and headers naming each file, and the two short text
 * fields. An upload is refused once its body is larger than `MAX_DROP_BYTES` plus this.
 */
export const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;
export const MAX_ARCHIVE_UNPACKED_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ROWS_PER_DROP = 50_000;
