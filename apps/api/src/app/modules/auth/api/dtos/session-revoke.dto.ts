import {IsString, Length} from 'class-validator';

export class SessionRevokeDto {
	@IsString()
	@Length(32, 32)
	sessionId: string;
}
