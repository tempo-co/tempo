import {faker} from '@faker-js/faker';
import {Server} from 'node:net';
import request, {Response} from 'supertest';
import TestAgent from 'supertest/lib/agent';

import {SignUpDto} from '@modules/auth/api/dtos/signup.dto';

import {loginAgent} from '../setup/e2e.setup';
import {EmailUtils} from './email-utils';

export function createAccountCredentials(): SignUpDto {
	return {
		name: faker.person.fullName(),
		email: faker.internet.email().toLowerCase(),
		password: faker.internet.password({length: 10}),
	};
}

export function expectValidationMessage(response: Response, pattern: RegExp): void {
	expect(response.body.message).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
}

/** Signs up a new account, verifies it through the welcome email, and returns a logged-in agent. */
export async function createVerifiedAccount(
	httpServer: Server,
	mailpitApiUrl: string,
): Promise<{id: string; credentials: SignUpDto; agent: TestAgent}> {
	const credentials = createAccountCredentials();
	const signupResponse = await request(httpServer).post('/auth/signup').send(credentials).expect(201);
	const code = await EmailUtils.getVerificationCode(credentials.email, mailpitApiUrl);
	await request(httpServer).post('/auth/signup/verify').send({email: credentials.email, code}).expect(200);
	const agent = await loginAgent(httpServer, credentials.email, credentials.password);
	return {id: signupResponse.body.id, credentials, agent};
}
