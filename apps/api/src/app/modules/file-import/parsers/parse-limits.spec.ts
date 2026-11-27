import {BANK_IMPORT_DROP_LIMITS} from '@wisp/contracts';

import {MAX_ARCHIVE_ENTRIES, MAX_DROP_BYTES, MAX_FILES_PER_DROP, MAX_FILE_BYTES} from './parse-limits';

describe('parse limits', () => {
	it('are the limits the web refuses a drop by before uploading it, and names in its copy', () => {
		expect(BANK_IMPORT_DROP_LIMITS).toEqual({
			MAX_FILE_BYTES,
			MAX_FILES_PER_DROP,
			MAX_DROP_BYTES,
			MAX_ARCHIVE_ENTRIES,
		});
	});
});
