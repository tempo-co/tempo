import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportSerializer} from '@nestjs/passport';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

type SerializeDoneCallback = (err: Error | null, id: Account['id']) => void;
type DeserializeDoneCallback = (err: Error | null, account: Account | null) => void;

@Injectable()
export class SessionSerializer extends PassportSerializer {
	constructor(private readonly accountService: AccountService) {
		super();
	}

	serializeUser(account: Account, done: SerializeDoneCallback) {
		done(null, account.id);
	}

	async deserializeUser(id: Account['id'], done: DeserializeDoneCallback) {
		try {
			const account = await this.accountService.findById(id);
			done(null, account);
		} catch {
			done(new UnauthorizedException(), null);
		}
	}
}
