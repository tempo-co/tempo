import {crc32, inflateRawSync} from 'node:zlib';

import {MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNPACKED_BYTES} from './parse-limits';
import {ParseRefusal} from './parse-result';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const STORED = 0;
const DEFLATED = 8;

export type ZipLimits = {maxEntries: number; maxUnpackedBytes: number};

/** Whether the bytes start like a zip archive (a local file header, or the end record of an empty archive). */
export function isZip(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;
	const signature = Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0);
	return signature === LOCAL_FILE_HEADER || signature === END_OF_CENTRAL_DIRECTORY;
}

/**
 * The contents of every file entry, in central-directory order. Entry names are never read: nothing is written
 * anywhere and directories are skipped. Declared sizes are not trusted; inflation is capped by the bytes left in
 * the archive budget, so a zip bomb stops at the cap instead of filling memory.
 */
export function readZipEntries(
	bytes: Uint8Array,
	limits: ZipLimits = {maxEntries: MAX_ARCHIVE_ENTRIES, maxUnpackedBytes: MAX_ARCHIVE_UNPACKED_BYTES},
): Buffer[] {
	const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = findEndOfCentralDirectory(archive);
	const entryCount = archive.readUInt16LE(end + 10);
	const directorySize = archive.readUInt32LE(end + 12);
	const directoryOffset = archive.readUInt32LE(end + 16);
	// ZIP64 markers: a statement archive never needs them.
	if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
		throw new ParseRefusal('parse_failed');
	}
	if (directoryOffset + directorySize > end) throw new ParseRefusal('parse_failed');

	const entries: Buffer[] = [];
	let unpackedBytes = 0;
	let offset = directoryOffset;
	for (let index = 0; index < entryCount; index++) {
		if (offset + 46 > end || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
			throw new ParseRefusal('parse_failed');
		}
		const flags = archive.readUInt16LE(offset + 8);
		const method = archive.readUInt16LE(offset + 10);
		const checksum = archive.readUInt32LE(offset + 16);
		const compressedSize = archive.readUInt32LE(offset + 20);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const externalAttributes = archive.readUInt32LE(offset + 38);
		const localHeaderOffset = archive.readUInt32LE(offset + 42);
		const nameEnd = offset + 46 + nameLength;
		if (nameEnd > end) throw new ParseRefusal('parse_failed');
		const isDirectory = archive[nameEnd - 1] === 0x2f || (externalAttributes & 0x10) !== 0;
		offset = nameEnd + extraLength + commentLength;
		if (isDirectory) continue;

		if (entries.length >= limits.maxEntries) throw new ParseRefusal('too_many_files');
		// Bit 0 marks an encrypted entry.
		if ((flags & 0x1) !== 0) throw new ParseRefusal('parse_failed');

		const data = readEntryData(archive, localHeaderOffset, compressedSize, directoryOffset);
		const content = inflateEntry(data, method, limits.maxUnpackedBytes - unpackedBytes);
		unpackedBytes += content.length;
		if (unpackedBytes > limits.maxUnpackedBytes) throw new ParseRefusal('archive_too_large');
		if (crc32(content) !== checksum) throw new ParseRefusal('parse_failed');
		entries.push(content);
	}
	return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
	const lowest = Math.max(0, archive.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_COMMENT_SIZE);
	for (let offset = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= lowest; offset--) {
		if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
	}
	throw new ParseRefusal('parse_failed');
}

function readEntryData(archive: Buffer, headerOffset: number, compressedSize: number, limit: number): Buffer {
	if (headerOffset + 30 > limit || archive.readUInt32LE(headerOffset) !== LOCAL_FILE_HEADER) {
		throw new ParseRefusal('parse_failed');
	}
	const start = headerOffset + 30 + archive.readUInt16LE(headerOffset + 26) + archive.readUInt16LE(headerOffset + 28);
	if (start + compressedSize > limit) throw new ParseRefusal('parse_failed');
	return archive.subarray(start, start + compressedSize);
}

function inflateEntry(data: Buffer, method: number, budget: number): Buffer {
	if (method === STORED) {
		if (data.length > budget) throw new ParseRefusal('archive_too_large');
		return data;
	}
	if (method !== DEFLATED) throw new ParseRefusal('parse_failed');
	try {
		return inflateRawSync(data, {maxOutputLength: Math.max(1, budget)});
	} catch (error) {
		if ((error as {code?: unknown}).code === 'ERR_BUFFER_TOO_LARGE') throw new ParseRefusal('archive_too_large');
		throw new ParseRefusal('parse_failed');
	}
}
