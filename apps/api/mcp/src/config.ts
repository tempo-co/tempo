export function loadConfig(env: Record<string, string | undefined> = process.env) {
	const apiToken = env.TEMPO_API_TOKEN;
	if (!apiToken || !/^[\x21-\x7e]+$/.test(apiToken))
		throw new Error('TEMPO_API_TOKEN is required and must contain no whitespace or control characters.');
	let url: URL;
	try {
		url = new URL(env.TEMPO_API_URL ?? 'http://127.0.0.1:8080/api');
	} catch {
		throw new Error('TEMPO_API_URL must be an absolute HTTPS URL or loopback HTTP URL.');
	}
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			'TEMPO_API_URL requires HTTPS (HTTP is allowed only on loopback), with no credentials, query or fragment.',
		);
	}
	return {apiUrl: url.href.replace(/\/+$/, ''), apiToken};
}
