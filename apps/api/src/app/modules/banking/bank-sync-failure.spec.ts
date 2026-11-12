import {classifyProviderFailure} from './bank-sync-failure';
import {EnableBankingClientError} from './services/enable-banking.client';

describe('classifyProviderFailure', () => {
	it.each([
		['EXPIRED_SESSION', 401, 'session_ended'],
		['REVOKED_SESSION', 401, 'session_ended'],
		['CLOSED_SESSION', 400, 'session_ended'],
		['SESSION_DOES_NOT_EXIST', 404, 'session_ended'],
		[' expired-session ', undefined, 'session_ended'],
		['provider_session_not_authorized', undefined, 'session_ended'],
		['ASPSP_RATE_LIMIT_EXCEEDED', 400, 'rate_limited'],
		['provider_temporarily_unavailable', 429, 'rate_limited'],
		['UNAUTHORIZED_ACCESS', 401, 'application_auth'],
		['provider_request_failed', 401, 'application_auth'],
		['AUTHORIZATION_NOT_PROVIDED', 400, 'application_auth'],
		['UNAUTHORIZED_IP', 403, 'application_auth'],
		['provider_authentication_failed', undefined, 'application_auth'],
		['ASPSP_ACCOUNT_NOT_ACCESSIBLE', 403, 'failed'],
		['ACCESS_DENIED', 403, 'failed'],
		['consent_example', 403, 'failed'],
		['ASPSP_ERROR', 503, 'failed'],
		['provider_unreachable', undefined, 'failed'],
	])('classifies %j with HTTP %s as %s', (code, status, expected) => {
		expect(classifyProviderFailure(new EnableBankingClientError(code, status))).toBe(expected);
	});

	it('treats an exception that is not a provider error as an ordinary failure', () => {
		expect(classifyProviderFailure(new TypeError('example'))).toBe('failed');
	});
});
