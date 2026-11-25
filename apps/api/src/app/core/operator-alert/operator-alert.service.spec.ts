import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';

import {OperatorAlertService} from './operator-alert.service';

const alert = {kind: 'example-failure', subject: 'Example failure', text: 'Something failed.'};

function serviceWith(address: string | undefined, send: jest.Mock) {
	return new OperatorAlertService(
		{send} as unknown as EmailService,
		{get: () => address} as unknown as ConfigurationService,
	);
}

describe('OperatorAlertService', () => {
	it('sends nothing and resolves when no operator address is configured', async () => {
		const send = jest.fn();

		await expect(serviceWith(undefined, send).send(alert)).resolves.toBeUndefined();

		expect(send).not.toHaveBeenCalled();
	});

	it('resolves when the email cannot be queued, so the failure it reports stays the caller’s', async () => {
		const send = jest.fn().mockRejectedValue(new Error('Redis unavailable'));

		await expect(serviceWith('operator@example.test', send).send(alert)).resolves.toBeUndefined();
	});
});
