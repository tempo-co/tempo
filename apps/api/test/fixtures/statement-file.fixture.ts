import {crc32, deflateRawSync} from 'node:zlib';

/** Synthetic CAMT.053 and zip builders for file-import tests. Values are invented; IBANs are published examples. */

export const EXAMPLE_IBAN = 'NL91ABNA0417164300';
export const OTHER_EXAMPLE_IBAN = 'DE89370400440532013000';

export type CamtEntry = {
	amount: string;
	indicator?: 'CRDT' | 'DBIT';
	status?: string;
	/** `null` leaves the entry without a booking date. */
	bookingDate?: string | null;
	valueDate?: string;
	reference?: string;
	/** Raw `NtryDtls` content (one or more `TxDtls`); omitted entries carry no details, like card payments. */
	details?: string;
	info?: string;
	currency?: string;
};

export type CamtStatement = {
	iban?: string;
	otherId?: string;
	currency?: string;
	sequence?: string;
	opening?: string;
	closing?: string;
	/** The account servicer's BIC; ABN AMRO's by default, `null` for none. */
	servicerBic?: string | null;
	/** In document order. ABN AMRO lists a statement's entries newest first. */
	entries: CamtEntry[];
};

/** A camt.053 document; `version` picks the namespace and, from 08 on, the later status and BIC shapes. */
export function camt053(statements: CamtStatement[], version = '02'): string {
	const laterStatus = Number(version) >= 8;
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.${version}"><BkToCstmrStmt>` +
		`<GrpHdr><MsgId>EXAMPLE</MsgId><CreDtTm>2026-03-01T00:00:00</CreDtTm></GrpHdr>` +
		statements.map((statement) => camtStatement(statement, laterStatus)).join('') +
		`</BkToCstmrStmt></Document>`
	);
}

function camtStatement(statement: CamtStatement, laterStatus: boolean): string {
	const currency = statement.currency ?? 'EUR';
	const id = statement.otherId
		? `<Othr><Id>${statement.otherId}</Id></Othr>`
		: `<IBAN>${statement.iban ?? EXAMPLE_IBAN}</IBAN>`;
	const bic = statement.servicerBic === undefined ? 'ABNANL2A' : statement.servicerBic;
	const bicElement = laterStatus ? 'BICFI' : 'BIC';
	const servicer = bic ? `<Svcr><FinInstnId><${bicElement}>${bic}</${bicElement}></FinInstnId></Svcr>` : '';
	const balance = (type: string, amount: string) =>
		`<Bal><Tp><CdOrPrtry><Cd>${type}</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">${amount.replace('-', '')}</Amt>` +
		`<CdtDbtInd>${amount.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>2026-03-01</Dt></Dt></Bal>`;
	return (
		`<Stmt><Id>EXAMPLE-STMT</Id>` +
		(statement.sequence ? `<ElctrncSeqNb>${statement.sequence}</ElctrncSeqNb>` : '') +
		`<Acct><Id>${id}</Id><Ccy>${currency}</Ccy>${servicer}</Acct>` +
		(statement.opening ? balance('PRCD', statement.opening) : '') +
		(statement.closing ? balance('CLBD', statement.closing) : '') +
		statement.entries.map((entry) => camtEntry(entry, currency, laterStatus)).join('') +
		`</Stmt>`
	);
}

function camtEntry(entry: CamtEntry, accountCurrency: string, laterStatus: boolean): string {
	const status = entry.status ?? 'BOOK';
	return (
		`<Ntry><Amt Ccy="${entry.currency ?? accountCurrency}">${entry.amount}</Amt>` +
		`<CdtDbtInd>${entry.indicator ?? 'DBIT'}</CdtDbtInd>` +
		(laterStatus ? `<Sts><Cd>${status}</Cd></Sts>` : `<Sts>${status}</Sts>`) +
		(entry.bookingDate === null ? '' : `<BookgDt><Dt>${entry.bookingDate ?? '2026-03-02'}</Dt></BookgDt>`) +
		`<ValDt><Dt>${entry.valueDate ?? entry.bookingDate ?? '2026-03-02'}</Dt></ValDt>` +
		(entry.reference ? `<AcctSvcrRef>${entry.reference}</AcctSvcrRef>` : '') +
		`<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>CCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>` +
		(entry.details ? `<NtryDtls>${entry.details}</NtryDtls>` : '') +
		(entry.info ? `<AddtlNtryInf>${entry.info}</AddtlNtryInf>` : '') +
		`</Ntry>`
	);
}

/**
 * A workbook whose first sheet holds `rows`: strings as inline text cells, numbers as numeric cells (day serials for
 * dates), `null` as a missing cell.
 */
export function createWorkbook(rows: Array<Array<string | number | null>>): Buffer {
	const column = (index: number) => String.fromCharCode(65 + index);
	const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const sheetRows = rows.map(
		(cells, rowIndex) =>
			`<row r="${rowIndex + 1}">${cells
				.map((cell, index) => {
					const reference = `${column(index)}${rowIndex + 1}`;
					if (cell === null) return '';
					return typeof cell === 'number'
						? `<c r="${reference}"><v>${cell}</v></c>`
						: `<c r="${reference}" t="inlineStr"><is><t>${escape(cell)}</t></is></c>`;
				})
				.join('')}</row>`,
	);
	return createZip([
		{
			name: 'xl/workbook.xml',
			content:
				'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
		},
		{
			name: 'xl/_rels/workbook.xml.rels',
			content:
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
		},
		{
			name: 'xl/worksheets/sheet1.xml',
			content: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
		},
	]);
}

export type ZipEntry = {
	name: string;
	content: Buffer | string;
	/** 8 (deflate, default) or 0 (stored). */
	method?: 0 | 8;
	/** The uncompressed size written into the headers; defaults to the real size. */
	declaredSize?: number;
	/** A checksum to write instead of the real one. */
	crc?: number;
	/** Already-deflated data to store as the entry instead of compressing `content`. */
	deflated?: Buffer;
};

/** A zip archive written by hand, so tests can declare sizes and checksums that lie. */
export function createZip(entries: ZipEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
		const method = entry.deflated ? 8 : (entry.method ?? 8);
		const data = entry.deflated ?? (method === 8 ? deflateRawSync(content) : content);
		const name = Buffer.from(entry.name);
		const checksum = entry.crc ?? crc32(content);
		const size = entry.declaredSize ?? content.length;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(size, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(size, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
