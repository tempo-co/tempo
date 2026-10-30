'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const requireFromApp = require('node:module').createRequire('/usr/src/app/package.json');

const devDependencies = JSON.parse(fs.readFileSync('/tmp/dev-dependencies.json', 'utf8'));
const modulesPath = '/usr/src/app/node_modules';
const remainingDevDependencies = devDependencies.filter((name) => fs.existsSync(path.join(modulesPath, name)));

assert.deepEqual(remainingDevDependencies, [], `Development dependencies remain in runtime image: ${remainingDevDependencies.join(', ')}`);

const manifest = require('/usr/src/app/package.json');
assert.deepEqual(Object.keys(manifest.devDependencies ?? {}), [], 'Runtime package.json still declares devDependencies');

// Env files are host configuration; test values in the image would be loaded whenever NODE_ENV=test.
const envFiles = fs.readdirSync('/usr/src/app').filter((name) => name === '.env' || name.startsWith('.env.'));
assert.deepEqual(envFiles, [], `Env files present in runtime image: ${envFiles.join(', ')}`);

const emailTemplatesDirectory = '/usr/src/app/dist/src/app/core/email/templates';
for (const template of [
	'account-deleted.hbs',
	'reset-password.hbs',
	'verify-new-email.hbs',
	'welcome.hbs',
	'partials/button.hbs',
	'partials/code-block.hbs',
	'partials/layout.hbs',
]) {
	const templatePath = path.join(emailTemplatesDirectory, template);
	assert.ok(fs.existsSync(templatePath), `Email template missing from runtime image: ${templatePath}`);
}

Object.assign(process.env, {
	NODE_ENV: 'production',
	WEB_BASE_URL: 'http://web.example.invalid',
	PORT: '3000',
	API_URL: 'http://api.example.invalid',
	DB_HOST: 'db',
	DB_PORT: '5432',
	DB_USERNAME: 'synthetic',
	DB_PASSWORD: 'synthetic',
	DB_NAME: 'tempo',
	DB_SYNCHRONIZE: 'false',
	DB_PGADMIN_PORT: '5050',
	SESSION_SECRET: 'synthetic-only',
	SESSION_EXPIRATION: '1d',
	SESSION_REDIS_KEY: 'synthetic:session',
	REDIS_URL: 'redis://redis:6379',
	REDIS_PORT: '6379',
	REDIS_HOST: 'redis',
	REDIS_INSIGHT_PORT: '8001',
	BANKING_INTEGRATION_ENABLED: 'false',
	ENABLE_BANKING_API_URL: 'https://banking.example.invalid',
	ENABLE_BANKING_APPLICATION_ID: 'synthetic',
	ENABLE_BANKING_REDIRECT_URL: 'https://web.example.invalid/callback',
	BANKING_SESSION_ENCRYPTION_KEY_B64: 'synthetic-only',
	EMAIL_HOST: 'mailpit',
	EMAIL_PORT: '1025',
	EMAIL_UI_PORT: '8025',
	EMAIL_UI_URL: 'http://mailpit.example.invalid',
	EMAIL_VERIFICATION_EXPIRATION: '1d',
	EMAIL_VERIFICATION_REDIS_KEY: 'synthetic:verify',
	PASSWORD_RESET_EXPIRATION: '1d',
	PASSWORD_RESET_REDIS_KEY: 'synthetic:reset',
	THROTTLE_TTL: '60s',
	THROTTLE_LIMIT: '100',
});

for (const dependency of [
	'@nestjs/core',
	'@nestjs/platform-express',
	'@nestjs/typeorm',
	'@nestjs/terminus',
	'@nestjs-modules/mailer',
	'@css-inline/css-inline',
	'typeorm',
	'pg',
	'ioredis',
	'argon2',
]) {
	requireFromApp(dependency);
}

requireFromApp('/usr/src/app/dist/src/app.module.js');

console.log(`Runtime image smoke check passed; ${devDependencies.length} declared dev dependencies are absent.`);
