import {configSchema} from './config.schema';

const baseConfig = {
	WEB_BASE_URL: 'https://example.test/',
	NODE_ENV: 'test',
	PORT: '3000',
	API_URL: 'http://api:3000',
	DB_HOST: 'postgres',
	DB_PORT: '5432',
	DB_USERNAME: 'tempo',
	DB_PASSWORD: 'test-password',
	DB_NAME: 'tempo',
	DB_SYNCHRONIZE: 'false',
	DB_PGADMIN_PORT: '5050',
	SESSION_SECRET: 'test-session-secret',
	SESSION_EXPIRATION: '30d',
	SESSION_REDIS_KEY: 'sess',
	REDIS_URL: 'redis://redis:6379',
	REDIS_PORT: '6379',
	REDIS_HOST: 'redis',
	REDIS_INSIGHT_PORT: '5540',
	ENABLE_BANKING_API_URL: 'https://api.enablebanking.com',
	ENABLE_BANKING_APPLICATION_ID: 'test-application',
	ENABLE_BANKING_PRIVATE_KEY_B64: 'test-private-key',
	ENABLE_BANKING_REDIRECT_URL: 'https://example.test/callback',
	BANKING_SESSION_ENCRYPTION_KEY_B64: 'test-encryption-key',
	EMAIL_HOST: 'mailpit',
	EMAIL_PORT: '1025',
	EMAIL_UI_PORT: '8025',
	EMAIL_UI_URL: 'http://mailpit:8025',
	EMAIL_VERIFICATION_EXPIRATION: '1d',
	EMAIL_VERIFICATION_REDIS_KEY: 'email-verification',
	PASSWORD_RESET_EXPIRATION: '1h',
	PASSWORD_RESET_REDIS_KEY: 'password-reset',
	THROTTLE_TTL: '1m',
	THROTTLE_LIMIT: '100',
};

describe('boolean environment configuration', () => {
	it('parses false strings as false for schema sync and email TLS', () => {
		const parsed = configSchema.parse({
			...baseConfig,
			DB_SYNCHRONIZE: 'false',
			EMAIL_SECURE: 'false',
		});

		expect(parsed.DB_SYNCHRONIZE).toBe(false);
		expect(parsed.EMAIL_SECURE).toBe(false);
	});

	it('parses true strings as true for schema sync and email TLS', () => {
		const parsed = configSchema.parse({
			...baseConfig,
			DB_SYNCHRONIZE: 'true',
			EMAIL_SECURE: 'true',
		});

		expect(parsed.DB_SYNCHRONIZE).toBe(true);
		expect(parsed.EMAIL_SECURE).toBe(true);
	});
});

describe('SMTP configuration', () => {
	it('keeps Mailpit usable without SMTP credentials', () => {
		const parsed = configSchema.parse(baseConfig);

		expect(parsed.EMAIL_USERNAME).toBeUndefined();
		expect(parsed.EMAIL_PASSWORD).toBeUndefined();
		expect(parsed.EMAIL_REQUIRE_TLS).toBe(false);
		expect(parsed.EMAIL_FROM).toBeUndefined();
	});

	it('accepts authenticated Gmail SMTP with required STARTTLS and a configured sender', () => {
		const parsed = configSchema.parse({
			...baseConfig,
			EMAIL_HOST: 'smtp.gmail.com',
			EMAIL_PORT: '587',
			EMAIL_SECURE: 'false',
			EMAIL_REQUIRE_TLS: 'true',
			EMAIL_USERNAME: 'mailer@example.test',
			EMAIL_PASSWORD: 'synthetic-app-password',
			EMAIL_FROM: 'Tempo <mailer@example.test>',
		});

		expect(parsed.EMAIL_REQUIRE_TLS).toBe(true);
		expect(parsed.EMAIL_USERNAME).toBe('mailer@example.test');
		expect(parsed.EMAIL_PASSWORD).toBe('synthetic-app-password');
		expect(parsed.EMAIL_FROM).toBe('Tempo <mailer@example.test>');
	});

	it.each([
		[
			'missing SMTP credentials',
			{
				EMAIL_HOST: 'smtp.gmail.com',
				EMAIL_PORT: '587',
				EMAIL_SECURE: 'false',
				EMAIL_REQUIRE_TLS: 'true',
				EMAIL_FROM: 'Tempo <mailer@example.test>',
			},
		],
		[
			'missing required STARTTLS',
			{
				EMAIL_HOST: 'smtp.gmail.com',
				EMAIL_PORT: '587',
				EMAIL_SECURE: 'false',
				EMAIL_USERNAME: 'mailer@example.test',
				EMAIL_PASSWORD: 'synthetic-app-password',
				EMAIL_FROM: 'Tempo <mailer@example.test>',
			},
		],
		[
			'using implicit TLS on a different port',
			{
				EMAIL_HOST: 'smtp.gmail.com',
				EMAIL_PORT: '465',
				EMAIL_SECURE: 'true',
				EMAIL_REQUIRE_TLS: 'true',
				EMAIL_USERNAME: 'mailer@example.test',
				EMAIL_PASSWORD: 'synthetic-app-password',
				EMAIL_FROM: 'Tempo <mailer@example.test>',
			},
		],
		[
			'missing a configured sender',
			{
				EMAIL_HOST: 'smtp.gmail.com',
				EMAIL_PORT: '587',
				EMAIL_SECURE: 'false',
				EMAIL_REQUIRE_TLS: 'true',
				EMAIL_USERNAME: 'mailer@example.test',
				EMAIL_PASSWORD: 'synthetic-app-password',
			},
		],
	])('rejects Gmail SMTP when %s', (_description, emailConfig) => {
		expect(configSchema.safeParse({...baseConfig, ...emailConfig}).success).toBe(false);
	});

	it('rejects incomplete credentials for any SMTP host', () => {
		expect(configSchema.safeParse({...baseConfig, EMAIL_USERNAME: 'mailer@example.test'}).success).toBe(false);
	});
});

describe('session cookie configuration', () => {
	it('defaults to the production cookie contract', () => {
		const parsed = configSchema.parse(baseConfig);

		expect(parsed.SESSION_COOKIE_NAME).toBe('session');
		expect(parsed.SESSION_COOKIE_PATH).toBe('/');
	});

	it('accepts an isolated mounted-path cookie contract', () => {
		const parsed = configSchema.parse({
			...baseConfig,
			SESSION_COOKIE_NAME: 'tempo_staging_session',
			SESSION_COOKIE_PATH: '/staging',
		});

		expect(parsed.SESSION_COOKIE_NAME).toBe('tempo_staging_session');
		expect(parsed.SESSION_COOKIE_PATH).toBe('/staging');
	});
});

describe('AI categorization configuration', () => {
	it('defaults to disabled Claude categorization without credentials', () => {
		const parsed = configSchema.parse(baseConfig);

		expect(parsed.AI_CATEGORIZATION_ENABLED).toBe(false);
		expect(parsed.AI_CATEGORIZATION_PROVIDER).toBe('claude');
		expect(parsed.AI_CATEGORIZATION_MODEL).toBe('claude-sonnet-5-5');
		expect(parsed.AI_CATEGORIZATION_EFFORT).toBe('high');
	});

	it('accepts only the effort levels Claude supports', () => {
		expect(configSchema.parse({...baseConfig, AI_CATEGORIZATION_EFFORT: 'xhigh'}).AI_CATEGORIZATION_EFFORT).toBe(
			'xhigh',
		);
		expect(() => configSchema.parse({...baseConfig, AI_CATEGORIZATION_EFFORT: 'extreme'})).toThrow();
	});

	it.each([
		['API only', {ANTHROPIC_API_KEY: 'synthetic-api-key'}],
		['subscription only', {AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/run/claude-bridge.sock'}],
		[
			'both routes',
			{ANTHROPIC_API_KEY: 'synthetic-api-key', AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/run/claude-bridge.sock'},
		],
	])('allows enabled categorization with %s', (_description, routeConfig) => {
		const parsed = configSchema.parse({...baseConfig, AI_CATEGORIZATION_ENABLED: 'true', ...routeConfig});

		expect(parsed).toMatchObject({AI_CATEGORIZATION_ENABLED: true, ...routeConfig});
	});

	it('rejects enabled categorization without either route', () => {
		expect(() => configSchema.parse({...baseConfig, AI_CATEGORIZATION_ENABLED: 'true'})).toThrow(
			'Configure ANTHROPIC_API_KEY or AI_CATEGORIZATION_SUBSCRIPTION_SOCKET',
		);
	});

	it('rejects a provider other than claude', () => {
		expect(
			configSchema.safeParse({...baseConfig, AI_CATEGORIZATION_PROVIDER: 'unsupported-provider'}).success,
		).toBe(false);
	});
});

describe('categorization web-search configuration', () => {
	it('defaults the fallback off', () => {
		const parsed = configSchema.parse(baseConfig);

		expect(parsed.AI_CATEGORIZATION_WEB_SEARCH_ENABLED).toBe(false);
	});

	it('accepts an explicit fallback toggle', () => {
		const parsed = configSchema.parse({
			...baseConfig,
			AI_CATEGORIZATION_WEB_SEARCH_ENABLED: 'true',
		});

		expect(parsed.AI_CATEGORIZATION_WEB_SEARCH_ENABLED).toBe(true);
	});
});

describe('banking integration configuration', () => {
	it('defaults banking integration to enabled for production compatibility', () => {
		const parsed = configSchema.parse(baseConfig);

		expect(parsed.BANKING_INTEGRATION_ENABLED).toBe(true);
	});

	it('allows disabled banking without a private provider key', () => {
		const {ENABLE_BANKING_PRIVATE_KEY_B64: _privateKey, ...withoutPrivateKey} = baseConfig;
		const parsed = configSchema.parse({
			...withoutPrivateKey,
			BANKING_INTEGRATION_ENABLED: 'false',
		});

		expect(parsed.BANKING_INTEGRATION_ENABLED).toBe(false);
	});

	it('rejects a private provider key when banking is disabled', () => {
		expect(() => configSchema.parse({...baseConfig, BANKING_INTEGRATION_ENABLED: 'false'})).toThrow();
	});

	it('requires a provider private key when banking integration is enabled', () => {
		expect(() =>
			configSchema.parse({
				...baseConfig,
				BANKING_INTEGRATION_ENABLED: 'true',
				ENABLE_BANKING_PRIVATE_KEY_B64: undefined,
				ENABLE_BANKING_PRIVATE_KEY_PATH: undefined,
			}),
		).toThrow('Configure exactly one');
	});
});
