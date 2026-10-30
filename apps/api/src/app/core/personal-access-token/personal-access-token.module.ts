import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {PersonalAccessToken} from './personal-access-token.entity';
import {PersonalAccessTokenService} from './personal-access-token.service';

@Module({
	imports: [TypeOrmModule.forFeature([PersonalAccessToken])],
	providers: [PersonalAccessTokenService],
	exports: [PersonalAccessTokenService],
})
export class PersonalAccessTokenModule {}
