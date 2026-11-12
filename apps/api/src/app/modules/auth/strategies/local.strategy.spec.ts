import {UnauthorizedException} from '@nestjs/common';
import argon2 from 'argon2';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {INVALID_CREDENTIALS} from '../api/constants/api-messages.constants';
import {LocalStrategy} from './local.strategy';

describe('LocalStrategy', () => {
	const password = 'synthetic-password';

	async function build(account: Account | null) {
		const accountService = {
			findByEmail: jest.fn().mockResolvedValue(account),
			hashPassword: (value: string) => argon2.hash(value),
			isPasswordValid: jest.fn((hash: string, value: string) => argon2.verify(hash, value)),
		};
		return {strategy: new LocalStrategy(accountService as unknown as AccountService), accountService};
	}

	it('returns the account for the right password', async () => {
		const account = {id: 'account-id', password: await argon2.hash(password)} as Account;
		const {strategy} = await build(account);

		await expect(strategy.validate('user@example.test', password)).resolves.toBe(account);
	});

	it.each([
		['a wrong password', true],
		['an unknown email', false],
	])('refuses %s after one password check with the same answer', async (_description, accountExists) => {
		const account = accountExists ? ({id: 'account-id', password: await argon2.hash(password)} as Account) : null;
		const {strategy, accountService} = await build(account);

		const refusal = strategy.validate('user@example.test', accountExists ? 'other-password' : password);

		await expect(refusal).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
		expect(accountService.isPasswordValid).toHaveBeenCalledTimes(1);
		const [hash] = accountService.isPasswordValid.mock.calls[0];
		expect(hash).toMatch(/^\$argon2id\$/);
	});
});
