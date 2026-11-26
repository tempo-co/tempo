import {BadRequestException} from '@nestjs/common';

import type {Account} from '@modules/account/account.entity';

import type {BankImportLayoutService} from '../bank-import-layout.service';
import type {BankImportService} from '../bank-import.service';
import type {BankRequestService} from '../bank-request.service';
import {BankImportController} from './bank-import.controller';

describe('BankImportController', () => {
	const account = {id: '00000000-0000-4000-8000-000000000001'} as Account;
	const importFiles = jest.fn().mockResolvedValue({});
	const propose = jest.fn().mockResolvedValue({});
	const controller = new BankImportController(
		{importFiles} as unknown as BankImportService,
		{propose} as unknown as BankImportLayoutService,
		{} as BankRequestService,
	);
	const file = {buffer: Buffer.from('synthetic')};
	/** Not an array of files, though it has a length and indexes: what a tampered request could carry. */
	const notAnArray = {length: 1, 0: file, map: () => [file.buffer]} as unknown as {buffer: Buffer}[];

	beforeEach(() => jest.clearAllMocks());

	it('takes only an array of exactly one file to work out its columns', async () => {
		await expect(controller.proposeLayout(notAnArray, undefined, account)).rejects.toThrow(BadRequestException);
		await expect(controller.proposeLayout([file, file], undefined, account)).rejects.toThrow(BadRequestException);
		await expect(controller.proposeLayout(undefined, undefined, account)).rejects.toThrow(BadRequestException);
		expect(propose).not.toHaveBeenCalled();

		await controller.proposeLayout([file], undefined, account);
		expect(propose).toHaveBeenCalledWith(account.id, file.buffer, null);
	});

	it('takes only an array of files to import', async () => {
		await expect(controller.importFiles(notAnArray, undefined, undefined, undefined, account)).rejects.toThrow(
			BadRequestException,
		);
		await expect(controller.importFiles([], undefined, undefined, undefined, account)).rejects.toThrow(
			BadRequestException,
		);
		expect(importFiles).not.toHaveBeenCalled();

		await controller.importFiles([file], undefined, undefined, undefined, account);
		expect(importFiles).toHaveBeenCalledWith(account.id, [file.buffer], {bankAccountId: null, bankId: null});
	});
});
