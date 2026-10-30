import {SessionData} from 'express-session';

import {Account} from '@modules/account/account.entity';

export interface AuthenticatedSession extends SessionData {
	passport?: {
		user?: Account['id'];
	};
	metadata?: {
		ip: string;
		deviceType: string;
		browserType: string;
		name: string;
		location: string;
		createdAt: string;
		lastSeenAt: string;
	};
}
