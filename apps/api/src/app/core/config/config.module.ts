import {Global, Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';

import {NodeEnv, configSchema} from './config.schema';
import {ConfigurationService} from './config.service';

const envFiles: Record<NodeEnv, string[]> = {
	development: ['.env.development.local', '.env.development'],
	test: ['.env.test.local', '.env.test'],
	production: ['.env.production.local', '.env.production'],
};
const NODE_ENV = (process.env.NODE_ENV as NodeEnv) || 'development';

function validate(config: Record<string, unknown>) {
	return configSchema.parse(config);
}

@Global()
@Module({
	imports: [
		ConfigModule.forRoot({
			envFilePath: envFiles[NODE_ENV],
			cache: true,
			validate,
		}),
	],
	providers: [ConfigurationService],
	exports: [ConfigurationService],
})
export class ConfigurationModule {}
