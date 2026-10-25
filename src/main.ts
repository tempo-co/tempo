import {ValidationPipe} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {DocumentBuilder, SwaggerDocumentOptions, SwaggerModule} from '@nestjs/swagger';
import helmet from 'helmet';

import {ConfigurationService} from '@core/config/config.service';
import {mcpOriginMiddleware} from '@core/personal-access-token/mcp-origin.middleware';

import {AppModule} from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {forceCloseConnections: true});
	const config = app.get(ConfigurationService);

	app.enableShutdownHooks();
	app.set('query parser', 'extended');
	app.use(mcpOriginMiddleware(new URL(config.get('WEB_BASE_URL')).origin));
	app.enableCors({origin: new URL(config.get('WEB_BASE_URL')).origin, credentials: true});
	if (config.get('NODE_ENV') === 'production') app.set('trust proxy', 1);
	app.use(helmet());
	app.disable('x-powered-by');
	app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true}));

	if (config.get('NODE_ENV') == 'development') {
		setupSwagger(app);
	}
	await app.listen(config.get('PORT'));
}
bootstrap();

function setupSwagger(app: NestExpressApplication) {
	const config = new DocumentBuilder().setTitle('Tempo API').build();
	const options: SwaggerDocumentOptions = {
		operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
	};
	const document = SwaggerModule.createDocument(app, config, options);

	SwaggerModule.setup('docs', app, document);
}
