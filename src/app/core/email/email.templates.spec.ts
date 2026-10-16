import Handlebars from 'handlebars';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const templatesDirectory = resolve(__dirname, 'templates');
const partials = ['layout', 'button', 'code-block'];
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

const renderEmailTemplate = (name: string, context: Record<string, string>) => {
	const handlebars = Handlebars.create();

	for (const partial of partials) {
		handlebars.registerPartial(
			partial,
			readFileSync(resolve(templatesDirectory, 'partials', `${partial}.hbs`), 'utf8'),
		);
	}

	const template = readFileSync(resolve(templatesDirectory, `${name}.hbs`), 'utf8');
	return handlebars.compile(template, {strict: true})(context);
};

describe('Email templates', () => {
	for (const {name, context} of emailTemplates) {
		it(`${name} renders inside a centered, padded card`, () => {
			const html = renderEmailTemplate(name, context);

			expect(html).toContain('width="500"');
			expect(html).toContain('align="center"');
			expect(html).toContain('bgcolor="#FBF8F1"');
			expect(html).toContain('border:1px solid #D0C8B9');
			expect(html).toContain('padding:24px');
		});
	}

	it('keeps the reset subject, copy, and supplied action URL', () => {
		const html = renderEmailTemplate('reset-password', resetPasswordContext);

		expect(html).toContain('<title>Reset your Tempo password</title>');
		expect(html).toContain('<h1>Reset your Tempo password</h1>');
		expect(html).toContain(
			'href="https://tempo.example.test/tempo/reset-password?email&#x3D;example%40example.test&amp;token&#x3D;00000000-0000-0000-0000-000000000000"',
		);
		expect(html).toContain('This link will expire in 1 hour.');
	});

	it('retains the configured button colors and verification-code styling', () => {
		const html = renderEmailTemplate('welcome', welcomeContext);

		expect(html).toContain('background-color: #8F4032');
		expect(html).toContain('color: #F6F1E8');
		expect(html).toContain('background-color: #EEE5D9');
		expect(html).toContain('123456');
	});
});
