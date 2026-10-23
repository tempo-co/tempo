import {INestApplication, ValidationPipe} from '@nestjs/common';
import {NestExpressApplication} from '@nestjs/platform-express';
import {Test} from '@nestjs/testing';
import {Server} from 'node:net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';

let app: INestApplication<Server>;
let aiCategorizationEnabled = false;
let aiCategorizationWebSearchEnabled = false;

export function enableAiCategorizationE2e(): void {
	aiCategorizationEnabled = true;
}

export function enableAiCategorizationWebSearchE2e(): void {
	aiCategorizationWebSearchEnabled = true;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'test';
	process.env.AI_CATEGORIZATION_ENABLED = String(aiCategorizationEnabled);
	process.env.AI_CATEGORIZATION_WEB_SEARCH_ENABLED = String(aiCategorizationWebSearchEnabled);
	delete process.env.AI_CATEGORIZATION_SUBSCRIPTION_SOCKET;

	if (aiCategorizationEnabled) {
		process.env.AI_CATEGORIZATION_PROVIDER = 'claude';
		process.env.AI_CATEGORIZATION_MODEL = 'test-model';
		process.env.ANTHROPIC_API_KEY = 'test-only-placeholder';
	} else {
		delete process.env.ANTHROPIC_API_KEY;
	}

	const [{seedAccounts}, {AppModule}] = await Promise.all([
		import('../../scripts/seed-data/seed-accounts'),
		import('../../src/app.module'),
	]);
	const moduleFixture = await Test.createTestingModule({imports: [AppModule]}).compile();
	app = moduleFixture.createNestApplication({forceCloseConnections: true});
	(app as NestExpressApplication).set('query parser', 'extended');
	app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true}));
	await app.init();

	await seedAccounts(app);
	// Starting the app and syncing the schema on a cold CI runner can take longer than Jest's 5 s default.
}, 60_000);

afterAll(async () => {
	if (app) await app.close();
});

export function getApp() {
	return app;
}

export async function loginAgent(httpServer: Server, email: string, password: string): Promise<TestAgent> {
	const agent = request.agent(httpServer);
	await agent.post('/auth/login').send({email, password}).expect(200);
	return agent;
}

export function getSessionCookie(response: request.Response): string | undefined {
	return ([] as string[])
		.concat(response.headers['set-cookie'] || [])
		.find((cookie) => cookie.startsWith('session='));
}
