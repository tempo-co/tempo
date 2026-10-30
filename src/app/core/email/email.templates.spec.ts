import {ConfigurationService} from '@core/config/config.service';

import {createMailerOptions} from './email.module';

const mailerOptions = createMailerOptions({get: () => undefined} as unknown as ConfigurationService);
const resetPasswordContext = {
	name: 'Example User',
	resetUrl:
		'https://tempo.example.test/tempo/reset-password?email=example%40example.test&token=00000000-0000-0000-0000-000000000000',
	expiration: '1 hour',
};
const welcomeContext = {
	name: 'Example User',
	verificationUrl: 'https://tempo.example.test/tempo/verify?token=synthetic',
	code: '123456',
	expiration: '1 hour',
};
const emailTemplates: Array<{name: string; context: Record<string, string>}> = [
	{
		name: 'account-deleted',
		context: {name: 'Example User'},
	},
	{
		name: 'bank-consent-expiring',
		context: {
			subject: 'Your Example Bank connection to Tempo ends soon',
			bankName: 'Example Bank',
			consentEndsOn: '1 January 2030 at 00:00 UTC',
			bankConnectionsUrl: 'https://tempo.example.test/bank-connections',
		},
	},
	{
		name: 'bank-sync-broken',
		context: {
			subject: "Tempo can't sync Example Bank",
			bankName: 'Example Bank',
			reason: 'Recent sync attempts did not succeed.',
			lastSyncDescription: 'The last successful sync was on 1 January 2030 at 00:00 UTC.',
			bankConnectionsUrl: 'https://tempo.example.test/bank-connections',
		},
	},
	{
		name: 'email-changed',
		context: {name: 'Example User', oldEmail: 'old@example.test', newEmail: 'new@example.test'},
	},
	{
		name: 'reset-password',
		context: resetPasswordContext,
	},
	{
		name: 'verify-new-email',
		context: {
			name: 'Example User',
			verificationUrl: 'https://tempo.example.test/tempo/verify?token=synthetic',
			expiration: '1 hour',
		},
	},
	{
		name: 'welcome',
		context: welcomeContext,
	},
];

// Renders through the configured mailer adapter, including CSS inlining, as sent emails are.
const renderEmailTemplate = (name: string, context: Record<string, string>) =>
	new Promise<string>((resolvePromise, reject) => {
		const mail = {data: {template: name, context} as {template: string; context: object; html?: string}};
		mailerOptions.template.adapter.compile(
			mail,
			(error?: Error) => (error ? reject(error) : resolvePromise(mail.data.html ?? '')),
			mailerOptions,
		);
	});

describe('Email templates', () => {
	for (const {name, context} of emailTemplates) {
		it(`${name} renders inside a centered, padded card`, async () => {
			const html = await renderEmailTemplate(name, context);

			expect(html).toContain('width="500"');
			expect(html).toContain('align="center"');
			expect(html).toContain('bgcolor="#FBF8F1"');
			expect(html).toContain('border:1px solid #D0C8B9');
			expect(html).toContain('padding:24px');
		});
	}

	it('renders the reset subject, copy, and supplied action URL', async () => {
		const html = await renderEmailTemplate('reset-password', resetPasswordContext);

		expect(html).toContain('<title>Reset your Tempo password</title>');
		expect(html).toMatch(/<h1[^>]*>Reset your Tempo password<\/h1>/);
		expect(html).toContain(
			'href="https://tempo.example.test/tempo/reset-password?email=example%40example.test&amp;token=00000000-0000-0000-0000-000000000000"',
		);
		expect(html).toContain('This link will expire in 1 hour.');
	});

	it('renders the brand button colors and verification-code styling in light and dark themes', async () => {
		const html = await renderEmailTemplate('welcome', welcomeContext);

		expect(html).toContain('background-color: #8F4032');
		expect(html).toContain('color: #F6F1E8');
		expect(html).toContain('background-color: #EEE5D9');
		expect(html).toContain('123456');
		expect(html).toMatch(/<h1 style="[^"]*color: #28252B;/);
		expect(html).toContain('<meta name="color-scheme" content="light dark">');
		expect(html).toContain('@media (prefers-color-scheme: dark)');
		expect(html).toContain('.email-card { background-color: #201E24 !important;');
		expect(html).toContain('.email-button { background-color: #E59A7B !important; color: #17161B !important; }');
		expect(html).toContain('.email-code { background-color: #2A272E !important;');
		expect(html).toContain('class="email-card"');
		expect(html).toContain('class="email-button"');
		expect(html).toContain('class="email-code"');
	});
});
