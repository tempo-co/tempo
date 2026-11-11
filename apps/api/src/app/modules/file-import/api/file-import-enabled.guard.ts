import {CanActivate, Injectable, NotFoundException} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

/** Answers 404 for every import route while `FILE_IMPORT_ENABLED` is off, after authentication has run. */
@Injectable()
export class FileImportEnabledGuard implements CanActivate {
	constructor(private readonly configurationService: ConfigurationService) {}

	canActivate(): boolean {
		if (this.configurationService.get('FILE_IMPORT_ENABLED') !== true) throw new NotFoundException();
		return true;
	}
}
