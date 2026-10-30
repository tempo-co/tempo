import {RedisStore} from 'connect-redis';
import {Request} from 'express';
import {SessionData} from 'express-session';
import Redis from 'ioredis';

type Callback = (err?: unknown) => void;

/**
 * A RedisStore that never recreates a session deleted while a request using it was in flight.
 *
 * Authenticated requests save their session again whenever they change it (SessionMiddleware refreshes a
 * stale `lastSeenAt`), and RedisStore saves with a plain SET. A request that loaded its session before a
 * logout or revocation would otherwise write the deleted session back and keep it usable.
 *
 * Touch is disabled: unchanged sessions cost no Redis command, and the stored expiry moves only with a save,
 * which is also the only time express-session sends the cookie again, so the two expire together.
 */
export class RevocationSafeRedisStore extends RedisStore {
	// Relies on express-session's Session#save passing the same object createSession returned.
	private readonly loadedSessions = new WeakSet<object>();

	constructor(
		private readonly redis: Redis,
		prefix: string,
	) {
		super({client: redis, prefix, disableTouch: true});
	}

	override createSession(req: Request, data: SessionData) {
		const session = super.createSession(req, data);
		this.loadedSessions.add(session);
		return session;
	}

	override async set(sid: string, sess: SessionData, cb?: Callback) {
		// New sessions (login, signup) are created normally. Sessions here always expire (cookie maxAge).
		const expires = sess.cookie.expires;
		if (!this.loadedSessions.has(sess) || !expires) return super.set(sid, sess, cb);

		const ttl = Math.ceil((new Date(expires).getTime() - Date.now()) / 1000);
		if (ttl <= 0) return super.set(sid, sess, cb);

		try {
			// XX: only overwrite the session if it still exists.
			await this.redis.set(this.prefix + sid, this.serializer.stringify(sess), 'EX', ttl, 'XX');
			cb?.();
		} catch (err) {
			cb?.(err);
		}
	}
}
