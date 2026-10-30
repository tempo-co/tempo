import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import argon2 from 'argon2';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	EMAIL_CHANGE_ACCOUNT_EMAIL,
	EMAIL_CHANGE_ACCOUNT_NAME,
	EMAIL_CHANGE_ACCOUNT_PASSWORD,
	OWN_TRANSFER_ACCOUNT_EMAIL,
	OWN_TRANSFER_ACCOUNT_NAME,
	OWN_TRANSFER_ACCOUNT_PASSWORD,
	PW_CHANGE_ACCOUNT_EMAIL,
	PW_CHANGE_ACCOUNT_NAME,
	PW_CHANGE_ACCOUNT_PASSWORD,
	PW_RESET_ACCOUNT_EMAIL,
	PW_RESET_ACCOUNT_NAME,
	PW_RESET_ACCOUNT_PASSWORD,
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_NAME,
	SESSION_TEST_ACCOUNT_PASSWORD,
	UNVERIFIED_ACCOUNT_EMAIL,
	UNVERIFIED_ACCOUNT_NAME,
	UNVERIFIED_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_NAME,
	VERIFIED_ACCOUNT_PASSWORD,
} from './seed.constants';

type AccountSeedData = Pick<Account, 'name' | 'email' | 'password' | 'isEmailVerified'>;

export async function seedAccounts(app: INestApplicationContext) {
	const accountRepository = app.get<Repository<Account>>(getRepositoryToken(Account));

	const accountsToSeed: AccountSeedData[] = [
		{
			name: VERIFIED_ACCOUNT_NAME,
			email: VERIFIED_ACCOUNT_EMAIL,
			password: VERIFIED_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
		{
			name: UNVERIFIED_ACCOUNT_NAME,
			email: UNVERIFIED_ACCOUNT_EMAIL,
			password: UNVERIFIED_ACCOUNT_PASSWORD,
			isEmailVerified: false,
		},
		{
			name: PW_CHANGE_ACCOUNT_NAME,
			email: PW_CHANGE_ACCOUNT_EMAIL,
			password: PW_CHANGE_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
		{
			name: PW_RESET_ACCOUNT_NAME,
			email: PW_RESET_ACCOUNT_EMAIL,
			password: PW_RESET_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
		{
			name: EMAIL_CHANGE_ACCOUNT_NAME,
			email: EMAIL_CHANGE_ACCOUNT_EMAIL,
			password: EMAIL_CHANGE_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
		{
			name: SESSION_TEST_ACCOUNT_NAME,
			email: SESSION_TEST_ACCOUNT_EMAIL,
			password: SESSION_TEST_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
		{
			name: OWN_TRANSFER_ACCOUNT_NAME,
			email: OWN_TRANSFER_ACCOUNT_EMAIL,
			password: OWN_TRANSFER_ACCOUNT_PASSWORD,
			isEmailVerified: true,
		},
	];

	const accounts = await Promise.all(
		accountsToSeed.map(async (account) => {
			const hashedPassword = await argon2.hash(account.password);
			return accountRepository.create({
				name: account.name,
				email: account.email,
				password: hashedPassword,
				isEmailVerified: account.isEmailVerified,
			});
		}),
	);
	await accountRepository.save(accounts);
}
