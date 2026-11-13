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
	SESSION_SECRET: 'x'.repeat(32),
	SESSION_EXPIRATION: '30d',
	SESSION_REDIS_KEY: 'sess',
	REDIS_URL: 'redis://redis:6379',
	ENABLE_BANKING_API_URL: 'https://api.enablebanking.com',
	ENABLE_BANKING_APPLICATION_ID: 'test-application',
	ENABLE_BANKING_PRIVATE_KEY_B64: 'test-private-key',
	ENABLE_BANKING_REDIRECT_URL: 'https://example.test/callback',
	BANKING_SESSION_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString('base64'),
	EMAIL_HOST: 'mailpit',
	EMAIL_PORT: '1025',
	EMAIL_VERIFICATION_EXPIRATION: '1d',
	EMAIL_VERIFICATION_REDIS_KEY: 'email-verification',
	PASSWORD_RESET_EXPIRATION: '1h',
	PASSWORD_RESET_REDIS_KEY: 'password-reset',
	THROTTLE_TTL: '1m',
	THROTTLE_LIMIT: '100',
};

describe('secrets and schema configuration', () => {
	it('accepts a 32-character session secret and a 32-byte banking key', () => {
		expect(configSchema.parse(baseConfig)).toMatchObject({
			SESSION_SECRET: baseConfig.SESSION_SECRET,
			BANKING_SESSION_ENCRYPTION_KEY_B64: baseConfig.BANKING_SESSION_ENCRYPTION_KEY_B64,
		});
	});

	it.each([
		['a session secret shorter than 32 characters', {SESSION_SECRET: 'x'.repeat(31)}, 'SESSION_SECRET'],
		[
			'a banking key of 31 bytes',
			{BANKING_SESSION_ENCRYPTION_KEY_B64: Buffer.alloc(31, 7).toString('base64')},
			'BANKING_SESSION_ENCRYPTION_KEY_B64',
		],
		[
			'a banking key of 33 bytes',
			{BANKING_SESSION_ENCRYPTION_KEY_B64: Buffer.alloc(33, 7).toString('base64')},
			'BANKING_SESSION_ENCRYPTION_KEY_B64',
		],
		[
			'a banking key that is not base64 of a key',
			{BANKING_SESSION_ENCRYPTION_KEY_B64: 'synthetic-key'},
			'BANKING_SESSION_ENCRYPTION_KEY_B64',
		],
		['schema sync in production', {NODE_ENV: 'production', DB_SYNCHRONIZE: 'true'}, 'DB_SYNCHRONIZE'],
	])('rejects %s', (_description, override, path) => {
		const result = configSchema.safeParse({...baseConfig, ...override});

		expect(result.success).toBe(false);
		expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path]);
	});

	it.each([
		['development', 'true'],
		['test', 'true'],
		['production', 'false'],
	])('accepts DB_SYNCHRONIZE in %s set to %s', (NODE_ENV, DB_SYNCHRONIZE) => {
		expect(configSchema.safeParse({...baseConfig, NODE_ENV, DB_SYNCHRONIZE}).success).toBe(true);
	});
});

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

	it('rejects a model the subscription bridge does not accept when the bridge is configured', () => {
		const bridgeConfig = {
			...baseConfig,
			AI_CATEGORIZATION_ENABLED: 'true',
			AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/run/claude-bridge.sock',
		};

		expect(() => configSchema.parse({...bridgeConfig, AI_CATEGORIZATION_MODEL: 'synthetic-model'})).toThrow(
			'AI_CATEGORIZATION_MODEL must be one of the subscription bridge models',
		);
		expect(configSchema.parse({...bridgeConfig, AI_CATEGORIZATION_MODEL: 'claude-opus-5-5'})).toMatchObject({
			AI_CATEGORIZATION_MODEL: 'claude-opus-5-5',
		});
		expect(
			configSchema.parse({
				...baseConfig,
				AI_CATEGORIZATION_ENABLED: 'true',
				ANTHROPIC_API_KEY: 'synthetic-api-key',
				AI_CATEGORIZATION_MODEL: 'synthetic-model',
			}),
		).toMatchObject({AI_CATEGORIZATION_MODEL: 'synthetic-model'});
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

describe('file import column mapper configuration', () => {
	it('defaults the mapper off, with the categorization model', () => {
		expect(configSchema.parse(baseConfig)).toMatchObject({
			FILE_IMPORT_MAPPER_ENABLED: false,
			FILE_IMPORT_MAPPER_MODEL: 'claude-sonnet-5-5',
		});
	});

	it('enables the mapper only with an Anthropic API key', () => {
		const mapper = {...baseConfig, FILE_IMPORT_MAPPER_ENABLED: 'true'};
		expect(() => configSchema.parse(mapper)).toThrow('when the file import column mapper is enabled');
		expect(() =>
			configSchema.parse({...mapper, AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/run/claude-bridge.sock'}),
		).toThrow('when the file import column mapper is enabled');
		expect(configSchema.parse({...mapper, ANTHROPIC_API_KEY: 'synthetic-api-key'})).toMatchObject({
			FILE_IMPORT_MAPPER_ENABLED: true,
		});
	});
});

describe('merchant logo configuration', () => {
	it('allows cached-only display without a model route', () => {
		expect(
			configSchema.parse({...baseConfig, MERCHANT_LOGOS_ENABLED: 'true', MERCHANT_LOGOS_CACHED_ONLY: 'true'}),
		).toMatchObject({MERCHANT_LOGOS_ENABLED: true, MERCHANT_LOGOS_CACHED_ONLY: true});
		expect(configSchema.parse(baseConfig)).toMatchObject({MERCHANT_LOGOS_CACHED_ONLY: false});
	});

	it('defaults merchant logos off and enables acquisition only with a model route', () => {
		expect(configSchema.parse(baseConfig).MERCHANT_LOGOS_ENABLED).toBe(false);
		expect(() => configSchema.parse({...baseConfig, MERCHANT_LOGOS_ENABLED: 'true'})).toThrow(
			'when merchant logos are enabled',
		);
		const subscription = {AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: '/run/claude-bridge.sock'};
		expect(configSchema.parse({...baseConfig, MERCHANT_LOGOS_ENABLED: 'true', ...subscription})).toMatchObject({
			MERCHANT_LOGOS_ENABLED: true,
		});
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

describe('web push configuration', () => {
	const vapid = {
		WEB_PUSH_VAPID_PUBLIC_KEY: 'test-public-key',
		WEB_PUSH_VAPID_PRIVATE_KEY: 'test-private-key',
		WEB_PUSH_VAPID_SUBJECT: 'mailto:push@example.test',
	};

	it('accepts no keys, which turns push off, or all three', () => {
		expect(configSchema.parse(baseConfig).WEB_PUSH_VAPID_PUBLIC_KEY).toBeUndefined();
		const empty = {WEB_PUSH_VAPID_PUBLIC_KEY: '', WEB_PUSH_VAPID_PRIVATE_KEY: '', WEB_PUSH_VAPID_SUBJECT: ''};
		expect(configSchema.parse({...baseConfig, ...empty}).WEB_PUSH_VAPID_PUBLIC_KEY).toBeUndefined();
		expect(configSchema.parse({...baseConfig, ...vapid})).toMatchObject(vapid);
	});

	it.each(Object.keys(vapid))('rejects the keys without %s', (missing) => {
		const {[missing as keyof typeof vapid]: _omitted, ...partial} = vapid;
		expect(configSchema.safeParse({...baseConfig, ...partial}).success).toBe(false);
	});

	it('rejects a contact that is not mailto: or https:', () => {
		expect(
			configSchema.safeParse({...baseConfig, ...vapid, WEB_PUSH_VAPID_SUBJECT: 'push@example.test'}).success,
		).toBe(false);
	});
});
