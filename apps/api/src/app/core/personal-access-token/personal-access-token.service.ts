import {Injectable, NotFoundException, UnauthorizedException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	CreatedPersonalAccessToken,
	PersonalAccessToken as PersonalAccessTokenResponse,
	PersonalAccessTokenScope,
} from '@tempo/contracts';
import {createHash, randomBytes} from 'node:crypto';
import {IsNull, Repository} from 'typeorm';

import {PersonalAccessToken} from './personal-access-token.entity';

@Injectable()
export class PersonalAccessTokenService {
	constructor(@InjectRepository(PersonalAccessToken) private readonly tokens: Repository<PersonalAccessToken>) {}

	/** `expiresInDays` null keeps the token until it is revoked. */
	async create(accountId: string, name: string, expiresInDays: number | null): Promise<CreatedPersonalAccessToken> {
		const token = `tempo_pat_${randomBytes(32).toString('base64url')}`;
		const saved = await this.tokens.save(
			this.tokens.create({
				accountId,
				name,
				tokenHash: createHash('sha256').update(token).digest('hex'),
				prefix: token.slice(0, 20),
				scopes: ['read'],
				lastUsedAt: null,
				expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000),
				revokedAt: null,
			}),
		);
		return {...this.metadata(saved), token};
	}

	async list(accountId: string): Promise<PersonalAccessTokenResponse[]> {
		return (await this.tokens.find({where: {accountId, revokedAt: IsNull()}, order: {createdAt: 'DESC'}})).map(
			(token) => this.metadata(token),
		);
	}

	async revoke(accountId: string, id: string) {
		const result = await this.tokens.update({id, accountId, revokedAt: IsNull()}, {revokedAt: new Date()});
		if (!result.affected) throw new NotFoundException();
	}

	async revokeAll(accountId: string) {
		await this.tokens.update({accountId, revokedAt: IsNull()}, {revokedAt: new Date()});
	}

	async authenticate(authorization: string) {
		const token = /^Bearer (tempo_pat_[A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1];
		if (!token) throw new UnauthorizedException();
		const saved = await this.tokens
			.createQueryBuilder('token')
			.innerJoinAndSelect('token.account', 'account')
			.where('token.tokenHash = :tokenHash', {tokenHash: createHash('sha256').update(token).digest('hex')})
			.andWhere('token.revokedAt IS NULL')
			.andWhere('(token.expiresAt IS NULL OR token.expiresAt > CURRENT_TIMESTAMP)')
			.getOne();
		if (!saved || !saved.scopes.includes('read')) throw new UnauthorizedException();
		return saved;
	}

	async recordUse(id: string) {
		await this.tokens
			.createQueryBuilder()
			.update()
			.set({lastUsedAt: () => 'CURRENT_TIMESTAMP'})
			.where('id = :id', {id})
			.andWhere('"revokedAt" IS NULL')
			.andWhere(`("lastUsedAt" IS NULL OR "lastUsedAt" <= CURRENT_TIMESTAMP - INTERVAL '1 minute')`)
			.execute();
	}

	private metadata({
		id,
		name,
		prefix,
		scopes,
		createdAt,
		lastUsedAt,
		expiresAt,
	}: PersonalAccessToken): PersonalAccessTokenResponse {
		return {
			id,
			name,
			prefix,
			// create() writes only 'read'.
			scopes: scopes as PersonalAccessTokenScope[],
			createdAt: createdAt.toISOString(),
			lastUsedAt: lastUsedAt?.toISOString() ?? null,
			expiresAt: expiresAt?.toISOString() ?? null,
		};
	}
}
