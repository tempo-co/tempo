import Redis from 'ioredis';
import {Server} from 'net';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';
import {
	ALL_OTHER_SESSIONS_REVOKED,
	CANNOT_REVOKE_CURRENT_SESSION,
	INVALID_SESSION,
	NO_OTHER_SESSIONS_TO_REVOKE,
	SESSION_REVOKE_SUCCESS,
} from '@core/session/api-messages.constants';
import {SessionResponseDto} from '@core/session/session-response.dto';
import {LAST_SEEN_UPDATE_INTERVAL_MS, SessionService} from '@core/session/session.service';

import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';
import {expectValidationMessage} from '../../utils/auth-utils';

describe('AuthController - Sessions', () => {
	let httpServer: Server;
	let redis: Redis;
	let sessionPrefix: string;

	beforeAll(async () => {
		httpServer = getApp().getHttpServer();
		redis = getApp().get<Redis>(REDIS);
		sessionPrefix = `${getApp().get(ConfigurationService).get('SESSION_REDIS_KEY')}:`;
	});

	const readCurrentSessionId = async (agent: TestAgent) => {
		const sessions: SessionResponseDto[] = (await agent.get('/auth/sessions').expect(200)).body;
		return sessions.find((s) => s.isCurrent)!.id;
	};

	const readLastSeenAt = async (sessionId: string) =>
		JSON.parse((await redis.get(sessionPrefix + sessionId))!).metadata.lastSeenAt as string;

	/** Rewrites a stored session's `lastSeenAt` and gives it a short expiry, so a later save is visible. */
	const storeLastSeenAt = async (sessionId: string, lastSeenAt: string, ttlSeconds = 60) => {
		const key = sessionPrefix + sessionId;
		const data = JSON.parse((await redis.get(key))!);
		data.metadata.lastSeenAt = lastSeenAt;
		await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
	};

	const staleLastSeenAt = () => new Date(Date.now() - LAST_SEEN_UPDATE_INTERVAL_MS - 60_000).toISOString();

	describe('GET /auth/sessions', () => {
		let verifiedAgent1: TestAgent;
		let verifiedAgent2: TestAgent;

		beforeEach(async () => {
			verifiedAgent1 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			verifiedAgent2 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		});

		it('should return all active sessions, marking the current one', async () => {
			const response = await verifiedAgent1.get('/auth/sessions').expect(200);

			const sessions: SessionResponseDto[] = response.body;
			expect(Array.isArray(sessions)).toBe(true);
			expect(sessions.length).toBeGreaterThanOrEqual(2);

			const currentSessions = sessions.filter((s) => s.isCurrent === true);
			expect(currentSessions).toHaveLength(1);
			const currentSession = currentSessions[0];
			expect(currentSession).toBeDefined();
			expect(currentSession.isCurrent).toBe(true);

			const nonCurrentSessions = sessions.filter((s) => s.isCurrent === false);
			expect(nonCurrentSessions.length).toBeGreaterThanOrEqual(1);
			nonCurrentSessions.forEach((session) => {
				expect(session.isCurrent).toBe(false);
			});

			const expectedSessionStructure = {
				id: expect.any(String),
				ip: expect.any(String),
				deviceType: expect.any(String),
				browserType: expect.any(String),
				name: expect.any(String),
				location: expect.any(String),
				createdAt: expect.any(String),
				lastSeenAt: expect.any(String),
				isCurrent: expect.any(Boolean),
			};

			// Check structure and validity of all returned sessions
			sessions.forEach((session) => {
				expect(session).toEqual(expect.objectContaining(expectedSessionStructure));
				expect(session.id.length).toBeGreaterThan(0);
				expect(Date.parse(session.createdAt)).not.toBeNaN();
				expect(Date.parse(session.lastSeenAt)).not.toBeNaN();
			});

			// Verify making the request with the second agent also works
			const response2 = await verifiedAgent2.get('/auth/sessions').expect(200);
			const sessions2: SessionResponseDto[] = response2.body;
			expect(sessions2.length).toBeGreaterThanOrEqual(2);
			const currentSessions2 = sessions2.filter((s) => s.isCurrent === true);
			expect(currentSessions2).toHaveLength(1);
			// Verify agent 2's current session ID is different
			expect(currentSessions2[0].id).not.toEqual(currentSession.id);
		});
	});

	describe('authenticated requests', () => {
		it('records when a session was last seen at most once per update interval', async () => {
			const cookieName = getApp().get(ConfigurationService).get('SESSION_COOKIE_NAME');
			const agent = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
			const sessionId = await readCurrentSessionId(agent);
			const recent = await readLastSeenAt(sessionId);

			// A request soon after the last recorded one leaves the stored session as it was, expiry included.
			await storeLastSeenAt(sessionId, recent);
			const recentResponse = await agent.get('/accounts/me').expect(200);
			expect(await readLastSeenAt(sessionId)).toBe(recent);
			expect(await redis.ttl(sessionPrefix + sessionId)).toBeLessThanOrEqual(60);
			expect(recentResponse.headers['set-cookie']).toBeUndefined();

			// Once the recorded time is older than the interval, the next request records it again and the
			// session's expiry and cookie move forward with that save.
			const stale = staleLastSeenAt();
			await storeLastSeenAt(sessionId, stale);
			const before = Date.now();
			const staleResponse = await agent.get('/accounts/me').expect(200);
			expect(Date.parse(await readLastSeenAt(sessionId))).toBeGreaterThanOrEqual(before - 1000);
			expect(await redis.ttl(sessionPrefix + sessionId)).toBeGreaterThan(60);
			expect(staleResponse.headers['set-cookie']).toEqual([
				expect.stringMatching(new RegExp(`^${cookieName}=.*; Expires=`)),
			]);
		});
	});

	describe('DELETE /auth/sessions', () => {
		let verifiedAgent1: TestAgent;
		let verifiedAgent2: TestAgent;
		let verifiedAgent3: TestAgent;
		let currentSessionIdAgent1: string | null = null;

		beforeEach(async () => {
			verifiedAgent1 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			verifiedAgent2 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			verifiedAgent3 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			// Get current session ID for agent 1
			const response = await verifiedAgent1.get('/auth/sessions').expect(200);
			const sessions: SessionResponseDto[] = response.body;
			const currentSession = sessions.find((s) => s.isCurrent);
			expect(currentSession).toBeDefined();
			currentSessionIdAgent1 = currentSession!.id;
		});

		it('revokes other sessions of the authenticated account and keeps its personal access tokens working', async () => {
			const {body: pat} = await verifiedAgent1
				.post('/personal-access-tokens')
				.set('Origin', 'http://localhost:5173')
				.send({name: 'Example client'})
				.expect(201);
			await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(200);
			const initialResponse = await verifiedAgent1.get('/auth/sessions').expect(200);
			const initialSessions: SessionResponseDto[] = initialResponse.body;
			expect(initialSessions.length).toBeGreaterThanOrEqual(3);

			await verifiedAgent1
				.delete('/auth/sessions')
				.expect(200)
				.expect((res) => {
					expect(res.body.message).toBe(ALL_OTHER_SESSIONS_REVOKED);
				});

			// Verify only agent 1's session remains
			const finalResponse = await verifiedAgent1.get('/auth/sessions').expect(200);
			const finalSessions: SessionResponseDto[] = finalResponse.body;
			expect(finalSessions).toHaveLength(1);
			expect(finalSessions[0].isCurrent).toBe(true);
			expect(finalSessions[0].id).toEqual(currentSessionIdAgent1);

			await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(200);
			await verifiedAgent2.get('/accounts/me').expect(401);
			await verifiedAgent3.get('/accounts/me').expect(401);
		});

		it('should return success message and not change session count when only the current session exists', async () => {
			const agent = await loginAgent(httpServer, SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);

			const initialResponse = await agent.get('/auth/sessions').expect(200);
			expect(initialResponse.body).toHaveLength(1);
			expect(initialResponse.body[0].isCurrent).toBe(true);
			const currentId = initialResponse.body[0].id;

			await agent
				.delete('/auth/sessions')
				.expect(200)
				.expect((res) => {
					expect(res.body.message).toBe(NO_OTHER_SESSIONS_TO_REVOKE);
				});

			const finalResponse = await agent.get('/auth/sessions').expect(200);
			expect(finalResponse.body).toHaveLength(1);
			expect(finalResponse.body[0].id).toEqual(currentId);
		});
	});

	describe('DELETE /auth/sessions/:sessionId', () => {
		let verifiedAgent1: TestAgent; // Agent making the revoke request
		let sessionToRevokeId: string | null = null;
		let currentSessionId: string | null = null;

		beforeEach(async () => {
			// Login verified account - Session 1
			verifiedAgent1 = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			// Login verified account - Session 2
			await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);

			// Get sessions using agent 1 to identify IDs
			const response = await verifiedAgent1.get('/auth/sessions').expect(200);
			const sessions: SessionResponseDto[] = response.body;

			const currentSession = sessions.find((s) => s.isCurrent);
			const nonCurrentSession = sessions.find((s) => !s.isCurrent);

			// Ensure we have two sessions
			expect(currentSession).toBeDefined();
			expect(nonCurrentSession).toBeDefined();

			currentSessionId = currentSession!.id;
			sessionToRevokeId = nonCurrentSession!.id;
		});

		it('revokes another session for the authenticated account and keeps its personal access tokens', async () => {
			expect(sessionToRevokeId).toBeDefined();
			const {body: pat} = await verifiedAgent1
				.post('/personal-access-tokens')
				.set('Origin', 'http://localhost:5173')
				.send({name: 'Example single-session client'})
				.expect(201);

			await verifiedAgent1
				.delete(`/auth/sessions/${sessionToRevokeId}`)
				.expect(200)
				.expect((res) => {
					expect(res.body.message).toEqual(SESSION_REVOKE_SUCCESS);
				});

			// Verify the session is gone
			const responseAfter = await verifiedAgent1.get('/auth/sessions').expect(200);
			const sessionsAfter: SessionResponseDto[] = responseAfter.body;
			const revokedSession = sessionsAfter.find((s) => s.id === sessionToRevokeId);
			expect(revokedSession).toBeUndefined();
			// Ensure the current session still exists
			expect(sessionsAfter.some((s) => s.id === currentSessionId)).toBe(true);
			await request(httpServer).get('/bank-transactions').auth(pat.token, {type: 'bearer'}).expect(200);
		});

		it('should keep a session revoked when one of its requests was in flight', async () => {
			const victim = await loginAgent(httpServer, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
			const victimId = await readCurrentSessionId(victim);
			// A stale lastSeenAt makes the in-flight request save its session when it ends.
			await storeLastSeenAt(victimId, staleLastSeenAt(), 600);

			// Hold the victim's next request in its handler, after its session has been loaded.
			const sessionService = getApp().get(SessionService);
			const getSessions = sessionService.getSessions.bind(sessionService);
			let release!: () => void;
			const released = new Promise<void>((resolve) => (release = resolve));
			let entered!: () => void;
			const inHandler = new Promise<void>((resolve) => (entered = resolve));
			const spy = jest.spyOn(sessionService, 'getSessions').mockImplementationOnce(async (...args) => {
				entered();
				await released;
				return getSessions(...args);
			});

			try {
				const inFlight = victim.get('/auth/sessions').then((response) => response);
				await inHandler;
				await verifiedAgent1.delete(`/auth/sessions/${victimId}`).expect(200);
				release();
				await inFlight;
			} finally {
				release();
				spy.mockRestore();
			}

			await victim.get('/accounts/me').expect(401);
		});

		it('should fail with 409 Conflict when trying to revoke the current session', async () => {
			expect(currentSessionId).toBeDefined();

			await verifiedAgent1
				.delete(`/auth/sessions/${currentSessionId}`)
				.expect(409)
				.expect((res) => {
					expect(res.body.message).toBe(CANNOT_REVOKE_CURRENT_SESSION);
				});
		});

		it('should fail with 404 Not Found for a non-existent session ID', async () => {
			const nonExistentId = '00000000000000000000000000000000'; // 32 chars long

			await verifiedAgent1
				.delete(`/auth/sessions/${nonExistentId}`)
				.expect(404)
				.expect((res) => {
					expect(res.body.message).toBe(INVALID_SESSION);
				});
		});

		it.each([
			['too short', 'invalid-id', /sessionId must be longer than or equal to 32 characters/i],
			['too long', 'a'.repeat(33), /sessionId must be shorter than or equal to 32 characters/i],
		])(
			'should fail with 400 Bad Request for an invalid session ID format (%s)',
			async (_case, sessionId, message) => {
				const response = await verifiedAgent1.delete(`/auth/sessions/${sessionId}`).expect(400);
				expectValidationMessage(response, message);
			},
		);
	});
});
