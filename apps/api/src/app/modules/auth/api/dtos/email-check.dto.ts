import {IsEmail, IsNotEmpty, Length} from 'class-validator';

import {NormalizeEmail} from './normalize-email';

export class EmailCheckDto {
	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: string;
}
