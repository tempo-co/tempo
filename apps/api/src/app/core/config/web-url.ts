export function createWebUrl(path: string, baseUrl: string, params?: Record<string, string>): string {
	const base = new URL(baseUrl);
	base.pathname = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;

	const url = new URL(path.replace(/^\/+/, ''), base);
	if (params) url.search = new URLSearchParams(params).toString();
	return url.toString();
}
