import type {EmailCheckQuery} from '@tempo/contracts';
import {IsEmail, IsNotEmpty, Length} from 'class-validator';

import {NormalizeEmail} from './normalize-email';

export class EmailCheckDto implements EmailCheckQuery {
	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: string;
}
