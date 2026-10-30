import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';

import {Config} from './config.schema';

@Injectable()
export class ConfigurationService {
	constructor(private configService: ConfigService<Config, true>) {}

	/** Get a configuration value. */
	get<K extends keyof Config>(key: K): Config[K] {
		return this.configService.get(key, {infer: true});
	}
}
