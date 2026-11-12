import {ValidationPipe} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import helmet from 'helmet';

import {ConfigurationService} from '@core/config/config.service';
import {mcpOriginMiddleware} from '@core/personal-access-token/mcp-origin.middleware';

import {AppModule} from './app.module';

async function bootstrap() {
	// JSON only: the API takes no form posts, so an HTML form on another site cannot fill a request body.
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		forceCloseConnections: true,
		bodyParser: false,
	});
	app.useBodyParser('json');
	const config = app.get(ConfigurationService);

	app.enableShutdownHooks();
	app.set('query parser', 'extended');
	app.use(mcpOriginMiddleware(new URL(config.get('WEB_BASE_URL')).origin));
	app.enableCors({origin: new URL(config.get('WEB_BASE_URL')).origin, credentials: true});
	if (config.get('NODE_ENV') === 'production') app.set('trust proxy', 1);
	app.use(helmet());
	app.disable('x-powered-by');
	app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true}));

	await app.listen(config.get('PORT'));
}
bootstrap();
