import {z} from 'zod';

const portSchema = z.coerce.number().int().min(0).max(65535);

const durationPattern = /^[0-9]+(s|m|h|d|w)$/;
const durationSchema = z.string().regex(durationPattern);
const strictBooleanEnvSchema = z.preprocess((value) => {
	if (typeof value !== 'string') return value;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	return value;
}, z.boolean());

export const ENV_VALUES = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof ENV_VALUES)[number];

export const configSchema = z
	.object({
		// --- General ---
		WEB_BASE_URL: z.string().url(),
		NODE_ENV: z.enum(ENV_VALUES),
		PORT: portSchema,
		API_URL: z.string().min(1),

		// --- Database ---
		DB_HOST: z.string().min(1),
		DB_PORT: portSchema,
		DB_USERNAME: z.string().min(1),
		DB_PASSWORD: z.string().min(1),
		DB_NAME: z.string().min(1),
		DB_SYNCHRONIZE: strictBooleanEnvSchema,
		DB_PGADMIN_PORT: portSchema,

		// --- Session ---
		SESSION_SECRET: z.string().min(1),
		SESSION_EXPIRATION: durationSchema,
		SESSION_REDIS_KEY: z.string().min(1),
		SESSION_COOKIE_NAME: z.string().min(1).default('session'),
		SESSION_COOKIE_PATH: z
			.string()
			.regex(/^\/[^\s]*$/)
			.default('/'),

		// --- Redis ---
		REDIS_URL: z.string().url(),
		REDIS_PORT: portSchema,
		REDIS_HOST: z.string().min(1),
		REDIS_INSIGHT_PORT: portSchema,

		// --- AI categorization ---
		AI_CATEGORIZATION_ENABLED: strictBooleanEnvSchema.default(false),
		AI_CATEGORIZATION_PROVIDER: z.enum(['claude']).default('claude'),
		AI_CATEGORIZATION_MODEL: z.string().min(1).max(128).default('claude-opus-5-5'),
		AI_CATEGORIZATION_WEB_SEARCH_ENABLED: strictBooleanEnvSchema.default(false),
		ANTHROPIC_API_KEY: z.string().min(1).optional(),
		AI_CATEGORIZATION_SUBSCRIPTION_SOCKET: z.string().min(1).optional(),

		// --- APIs ---
		BANKING_INTEGRATION_ENABLED: strictBooleanEnvSchema.default(true),
		ENABLE_BANKING_API_URL: z.string().url(),
		ENABLE_BANKING_APPLICATION_ID: z.string().min(1),
		ENABLE_BANKING_PRIVATE_KEY_B64: z.string().min(1).optional(),
		ENABLE_BANKING_PRIVATE_KEY_PATH: z.string().min(1).optional(),
		ENABLE_BANKING_REDIRECT_URL: z.string().url(),
		BANKING_SESSION_ENCRYPTION_KEY_B64: z.string().min(1),

		// --- Banking synchronization ---
		BANKING_SYNC_INTERVAL: durationSchema.default('6h'),
		BANKING_SYNC_DISPATCH_INTERVAL: durationSchema.default('10m'),
		BANKING_SYNC_RUNNING_TIMEOUT: durationSchema.default('30m'),
		BANK_CONNECTION_ALERTS_ENABLED: strictBooleanEnvSchema.default(true),

		// --- Email ---
		EMAIL_HOST: z.string().min(1),
		EMAIL_PORT: portSchema,
		EMAIL_SECURE: strictBooleanEnvSchema.default(false),
		EMAIL_USERNAME: z.string().min(1).optional(),
		EMAIL_PASSWORD: z.string().min(1).optional(),
		EMAIL_REQUIRE_TLS: strictBooleanEnvSchema.default(false),
		EMAIL_FROM: z.string().trim().min(1).optional(),
		EMAIL_UI_PORT: portSchema,
		EMAIL_UI_URL: z.string().url(),
		EMAIL_VERIFICATION_EXPIRATION: durationSchema,
		EMAIL_VERIFICATION_REDIS_KEY: z.string().min(1),

		// --- Password reset ---
		PASSWORD_RESET_EXPIRATION: durationSchema,
		PASSWORD_RESET_REDIS_KEY: z.string().min(1),

		// --- Rate limiting ---
		THROTTLE_TTL: durationSchema,
		THROTTLE_LIMIT: z.coerce.number().int().positive(),
	})
	.superRefine((config, context) => {
		const hasEmailUsername = config.EMAIL_USERNAME !== undefined;
		const hasEmailPassword = config.EMAIL_PASSWORD !== undefined;

		if (hasEmailUsername !== hasEmailPassword) {
			context.addIssue({
				code: 'custom',
				path: ['EMAIL_USERNAME'],
				message: 'Configure both EMAIL_USERNAME and EMAIL_PASSWORD for SMTP authentication.',
			});
		}

		if (config.EMAIL_HOST === 'smtp.gmail.com') {
			if (!hasEmailUsername || !hasEmailPassword) {
				context.addIssue({
					code: 'custom',
					path: ['EMAIL_USERNAME'],
					message: 'Gmail SMTP requires EMAIL_USERNAME and EMAIL_PASSWORD.',
				});
			}

			if (config.EMAIL_PORT !== 587 || config.EMAIL_SECURE || !config.EMAIL_REQUIRE_TLS) {
				context.addIssue({
					code: 'custom',
					path: ['EMAIL_REQUIRE_TLS'],
					message: 'Gmail SMTP must use port 587 with STARTTLS required.',
				});
			}

			if (!config.EMAIL_FROM) {
				context.addIssue({
					code: 'custom',
					path: ['EMAIL_FROM'],
					message: 'Gmail SMTP requires a configured sender address.',
				});
			}
		}

		const hasPrivateKeyB64 = config.ENABLE_BANKING_PRIVATE_KEY_B64 !== undefined;
		const hasPrivateKeyPath = config.ENABLE_BANKING_PRIVATE_KEY_PATH !== undefined;

		if (config.BANKING_INTEGRATION_ENABLED && hasPrivateKeyB64 === hasPrivateKeyPath) {
			context.addIssue({
				code: 'custom',
				path: ['ENABLE_BANKING_PRIVATE_KEY_B64'],
				message: 'Configure exactly one of ENABLE_BANKING_PRIVATE_KEY_B64 or ENABLE_BANKING_PRIVATE_KEY_PATH.',
			});
		}

		if (!config.BANKING_INTEGRATION_ENABLED && (hasPrivateKeyB64 || hasPrivateKeyPath)) {
			context.addIssue({
				code: 'custom',
				path: ['BANKING_INTEGRATION_ENABLED'],
				message: 'Do not configure an Enable Banking private key when banking integration is disabled.',
			});
		}

		if (
			config.AI_CATEGORIZATION_ENABLED &&
			!config.ANTHROPIC_API_KEY &&
			!config.AI_CATEGORIZATION_SUBSCRIPTION_SOCKET
		) {
			context.addIssue({
				code: 'custom',
				path: ['ANTHROPIC_API_KEY'],
				message:
					'Configure ANTHROPIC_API_KEY or AI_CATEGORIZATION_SUBSCRIPTION_SOCKET when Claude categorization is enabled.',
			});
		}
	});

export type Config = z.infer<typeof configSchema>;
