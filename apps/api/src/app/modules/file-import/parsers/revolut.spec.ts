import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {createZip} from '../../../../../test/fixtures/statement-file.fixture';
import {ParseRefusal} from './parse-result';
import {parseRevolutXlsx} from './revolut';
import {readZipEntries} from './zip-reader';

const WORKBOOK = readFileSync(
	join(
		__dirname,
		'../../../../../test/fixtures/file-import/account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.xlsx',
	),
);

/** The fixture workbook with its first sheet's XML changed by `edit`. */
function editedWorkbook(edit: (sheet: string) => string): Buffer {
	return createZip(
		readZipEntries(WORKBOOK).map(({name, content}) => ({
			name,
			content: name === 'xl/worksheets/sheet1.xml' ? edit(content.toString('utf8')) : content,
		})),
	);
}

describe('parseRevolutXlsx', () => {
	it('refuses a workbook with a formula instead of reading or evaluating it', () => {
		const workbook = editedWorkbook((sheet) =>
			sheet.replace('<c r="F2" s="1"><v>200</v></c>', '<c r="F2" s="1"><f>100+100</f><v>200</v></c>'),
		);

		expect(() => parseRevolutXlsx(workbook)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('reads inline strings like shared ones', () => {
		const workbook = editedWorkbook((sheet) =>
			sheet.replace(
				/<c r="E3" s="1" t="s"><v>\d+<\/v><\/c>/,
				'<c r="E3" t="inlineStr"><is><t>Example Cafe</t></is></c>',
			),
		);

		expect(parseRevolutXlsx(workbook)[0].rows[1]).toMatchObject({description: 'Example Cafe', amount: '-4.50'});
	});
});
