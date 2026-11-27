import request from 'supertest';

import {getApp, webOrigin} from '../../setup/e2e.setup';
import {createAccountCredentials} from '../../utils/auth-utils';
import {EmailUtils, MAILPIT_API_URL} from '../../utils/email-utils';

describe('AuthController - Signup without a configured sender', () => {
	beforeEach(async () => {
		await EmailUtils.clearEmails(MAILPIT_API_URL);
	});

	it('sends the welcome email from the default Wisp sender with no Reply-To', async () => {
		const signUpDto = createAccountCredentials();

		await request(getApp().getHttpServer())
			.post('/auth/signup')
			.set('Origin', webOrigin())
			.send(signUpDto)
			.expect(201);

		const welcomeEmail = await EmailUtils.findEmailByRecipient(signUpDto.email, MAILPIT_API_URL);
		expect(welcomeEmail?.Subject).toBe('Confirm your email for Wisp');
		expect(welcomeEmail?.From).toEqual({Name: 'Wisp', Address: 'no-reply@localhost'});
		expect(welcomeEmail?.ReplyTo).toEqual([]);
	});
});
