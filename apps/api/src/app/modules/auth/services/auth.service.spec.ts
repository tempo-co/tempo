import {Request} from 'express';

import {AuthService} from './auth.service';

describe('AuthService.logOut', () => {
	function build() {
		const pushNotificationService = {removeForSession: jest.fn().mockResolvedValue(undefined)};
		const service = new AuthService(
			{} as never,
			{} as never,
			{} as never,
			pushNotificationService as never,
			{} as never,
		);
		let finishLogOut: (error?: Error) => void = () => undefined;
		const request = {
			user: {id: 'account-id'},
			session: {id: 'session-id'},
			logOut: jest.fn((_options: unknown, callback: (error?: Error) => void) => {
				finishLogOut = callback;
			}),
		};
		return {service, request, finish: (error?: Error) => finishLogOut(error)};
	}

	it('answers once passport has ended the session', async () => {
		const {service, request, finish} = build();
		let settled = false;
		const logout = service.logOut(request as unknown as Request).then((result) => {
			settled = true;
			return result;
		});

		await new Promise((resolve) => setImmediate(resolve));
		expect(request.logOut).toHaveBeenCalledWith({keepSessionInfo: false}, expect.any(Function));
		expect(settled).toBe(false);

		finish();
		await expect(logout).resolves.toEqual({message: 'User logged out.'});
	});

	it('fails when the session store cannot end the session', async () => {
		const {service, request, finish} = build();
		const logout = service.logOut(request as unknown as Request);

		await new Promise((resolve) => setImmediate(resolve));
		finish(new Error('synthetic store failure'));

		await expect(logout).rejects.toThrow('synthetic store failure');
	});
});
