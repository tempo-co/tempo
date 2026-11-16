import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseAbnAmroTxt} from './abn-amro-txt';
import {ParseRefusal} from './parse-result';

const FILE = readFileSync(join(__dirname, '../../../../../test/fixtures/file-import/TXT260305120000.TAB'));

describe('parseAbnAmroTxt', () => {
	it('refuses a row whose balance before plus its amount is not its balance after', () => {
		// The first row: 1000,00 - 12,50 = 987,50.
		const file = FILE.toString('latin1').replace('\t987,50\t', '\t987,51\t');

		expect(() => parseAbnAmroTxt(Buffer.from(file, 'latin1'))).toThrow(new ParseRefusal('parse_failed'));
	});
});
